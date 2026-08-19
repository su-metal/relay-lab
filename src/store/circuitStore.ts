"use client";

/**
 * 回路ドキュメントのストア（design.md §7）。
 *
 * 保持するのは **保存対象である `CircuitDocument` と選択状態、そして履歴だけ。**
 * シミュレーションの実行時状態は `simulationStore` に分ける。
 * 混ぜると保存 JSON に実行時状態が混入し、Undo 履歴も汚れる。
 *
 * Undo / Redo は `{ past, present, future }`（present = `document`）。
 * **スナップショットを取るのは 部品追加 / 削除 / 配線確定 / ドラッグ完了 の 4 点だけ。**
 * ドラッグ中の `moveComponent` とラベル編集は 1 操作で何十回も発火するので積まない。
 */

import { create } from "zustand";

import {
  connectionFromReactFlow,
  hasTerminalPair,
  isSameTerminalPair,
} from "@/circuit/adapter/reactflow";
import { getComponentDefinition } from "@/circuit/definitions";
import { fadeMsOf, outputVoltsOf, presetMsOf } from "@/circuit/engine";
import type {
  DimmerSettings,
  CircuitDocument,
  ComponentCategory,
  ComponentDefinition,
  LampColor,
} from "@/circuit/types";
import { DEFAULT_LAMP_COLOR, isLampColor } from "@/circuit/types";
import type { Connection } from "@xyflow/react";

type Point = { x: number; y: number };
type Viewport = { x: number; y: number; zoom: number };

/**
 * 履歴の上限。1 手あたりドキュメント 1 枚を丸ごと持つので、
 * 部品数 × 手数だけメモリを食う。実務の作業単位として 50 手戻れれば足りる。
 */
const HISTORY_LIMIT = 50;

const emptyDocument = (): CircuitDocument => ({
  version: 1,
  components: [],
  connections: [],
  viewport: { x: 0, y: 0, zoom: 1 },
});

let idCounter = 0;
const createId = (prefix: string) =>
  `${prefix}-${(++idCounter).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * 自動で振るラベルの接頭辞。実務の図面でよく使う記号に合わせる。
 * ユーザーが後から変更できる前提の初期値（`CircuitDocument.components[].label`）。
 */
const LABEL_PREFIX: Record<ComponentCategory, string> = {
  power: "PS",
  switch: "S",
  relay: "RY",
  lamp: "L",
  diode: "D",
  terminal: "TB",
  // 実務の図面ではタイマーは T / TR。リレーの RY と読み違えないよう分ける
  timer: "T",
  // 調光は DIM。L（ランプ）とも D（ダイオード）とも読み違えない綴りにする
  dimmer: "DIM",
};

/** 同じ接頭辞の最大番号 + 1 を返す（RY1 が居れば RY2） */
const nextLabel = (
  document: CircuitDocument,
  category: ComponentCategory,
): string => {
  const prefix = LABEL_PREFIX[category];
  const pattern = new RegExp(`^${prefix}(\\d+)$`);
  let max = 0;
  for (const component of document.components) {
    const matched = component.label?.match(pattern);
    if (matched) max = Math.max(max, Number(matched[1]));
  }
  return `${prefix}${max + 1}`;
};

export type CircuitStore = {
  document: CircuitDocument;
  /** 直前までのドキュメント（古い順）。末尾が Undo で戻る先 */
  past: readonly CircuitDocument[];
  /** Undo で押し出したドキュメント（新しい順）。先頭が Redo で進む先 */
  future: readonly CircuitDocument[];

  selectedComponentIds: readonly string[];
  selectedConnectionIds: readonly string[];

  /** パレットからのドロップ。`position` はキャンバス座標系の左上 */
  addComponent: (definition: ComponentDefinition, position: Point) => string;
  moveComponent: (componentId: string, position: Point) => void;

  /**
   * 複数の部品を一度に置き直す（配置の自動整理・design.md §8.9）。
   *
   * **`moveComponent` と違い履歴に 1 手だけ積む。** ドラッグ中の移動は
   * `beginComponentDrag` / `endComponentDrag` の対が履歴を受け持つが、
   * 自動整理は 1 回のボタン操作なので、部品 20 個が動いても Undo 1 回で戻る
   * こと自体が要件になる。
   *
   * 実際に動く部品が無ければ（空の Map・存在しない ID だけ）履歴を汚さない。
   * どこをどう整えるかは `adapter/auto-layout.ts` の純粋関数が決める。
   * ストアは寸法もレジストリも知らない。
   */
  applyLayout: (positions: ReadonlyMap<string, Point>) => void;

  /**
   * 部品と配線を **1 手として**消す。部品を消せばその端子に繋がる配線も道連れ。
   *
   * 削除の入口はこれ 1 本に絞る。要素ごとに呼べる API を残すと、範囲選択で
   * 5 個消したときに履歴が 5 手積まれ、1 回の削除を戻すのに 5 回 Undo が要る。
   */
  removeElements: (
    componentIds: readonly string[],
    connectionIds: readonly string[],
  ) => void;

  /**
   * インスタンスのラベル（"RY1"）を変更する。空文字は未設定（`undefined`）に戻す。
   *
   * 1 文字ごとに発火するので **Undo 履歴には積まない**（スナップショット地点は
   * 部品追加 / 削除 / 配線確定 / ドラッグ完了 の 4 点。design.md §7）。
   */
  setComponentLabel: (componentId: string, label: string) => void;

  /**
   * 部品を左右反転する（トグル）。複数渡せば **それぞれを個別に**反転する。
   *
   * 見た目だけの変更だが **履歴には積む。** 反転すると端子の出る辺が変わり、
   * 配線の取り回しが大きく動くので、ラベル編集と違って「1 手戻したい操作」になる。
   */
  flipComponents: (componentIds: readonly string[]) => void;

  /**
   * タイマーの設定時間を変える（design.md §5.13）。
   *
   * ラベルの変更（`setComponentLabel`）と違い **Undo の対象にする** ——
   * 設定時間は回路の動きそのものを変えるので、間違えたときに戻せないと困る。
   * 範囲外の値は定義の上下限へ丸める（判定はエンジンの `presetMsOf`）。
   */
  setComponentPreset: (componentId: string, presetMs: number) => void;

  /**
   * 調光出力の電圧を変える（design.md §5.17）。
   *
   * `setComponentPreset` とまったく同じ扱い —— **Undo の対象**にし、
   * 範囲外は定義の上下限へ丸め（判定はエンジンの `outputVoltsOf`）、
   * 調光出力以外の部品には書き込まない。回路の動き（繋いだ負荷の明るさ）を
   * 変える値なので、間違えたときに戻せないと困る。
   */
  setComponentChannelVolts: (
    componentId: string,
    channelId: string,
    volts: number,
  ) => void;

  /**
   * 調光出力のフェード時間を変える（design.md §5.18）。
   *
   * `setComponentPreset` とまったく同じ扱い —— **Undo の対象**にし、
   * 範囲外は定義の上下限へ丸め（判定はエンジンの `fadeMsOf`）、
   * `fade` を持たない部品には書き込まない。
   */
  setComponentFadeMs: (componentId: string, fadeMs: number) => void;

  /**
   * 調光器の盤ごとの設定を変える（design.md §4.15）。
   *
   * 渡した項目だけを差し替える —— 極性を切り替えるたびに上限や下限が
   * 既定へ戻ると、実機の DIP を 1 つ倒す操作とかけ離れる。
   * 調光入力を持たない部品には書き込まない。
   */
  setComponentDimmerSettings: (
    componentId: string,
    patch: Partial<DimmerSettings>,
  ) => void;

  /**
   * 表示ランプのレンズの色を変える（design.md §4.11）。
   *
   * **Undo の対象にする。** 盤面では色そのものが意味を持つ（赤＝異常・
   * 緑＝運転）ので、押し間違いを戻せないと図の意味が変わったままになる。
   * ランプ以外の部品には書き込まない —— 誰も読まない値を保存 JSON に残さない。
   */
  setComponentLampColor: (componentId: string, color: LampColor) => void;

  /**
   * インスタンスの `definitionId` だけを差し替える（同じ ID・位置・ラベルは維持）。
   *
   * 接続 (`CircuitConnection`) は componentId + terminalId で端子を指すので、
   * 差し替え後の定義に無い端子を指す配線だけを間引けば、他の配線は
   * インスタンス ID が同じままつながり続ける。A 接点 → B 接点のようにラベルが
   * 一致する差し替えでは配線は 1 本も切れない。MY4N → MY2N のように接点が
   * 減る差し替えでは、無くなった端子への配線だけが黙って外れる（design.md §7）。
   *
   * 履歴は 1 手。差し替え先が無い ID・現在と同じ定義への差し替えは空振りとして
   * 履歴を汚さない。
   */
  replaceComponentDefinition: (
    componentId: string,
    definition: ComponentDefinition,
  ) => void;

  /**
   * React Flow の接続イベントから配線を足す。
   * 端子以外への接続と重複配線はここで捨てる（adapter が判定する）。
   */
  addConnection: (params: Connection) => void;

  /**
   * 既存の配線の端を掴み直して、別の端子へ繋ぎ替える（design.md §8.8）。
   *
   * **配線 ID を変えない。** 同じ 1 本を引き回しただけなので、消して張り直すのでは
   * なく端子参照だけを差し替える。ID が変わると選択が外れ、レーン（§8.7）も
   * 振り直しになり、「今掴んでいる線」が画面上で別物にすり替わる。
   *
   * 履歴は 1 手。空振り（存在しない ID・掴んで同じ端子へ戻した・既に同じ端子ペアの
   * 配線がある）は履歴を汚さない。
   */
  reconnectConnection: (connectionId: string, params: Connection) => void;

  setComponentSelected: (componentId: string, selected: boolean) => void;
  setConnectionSelected: (connectionId: string, selected: boolean) => void;
  /**
   * 選択中の配線を丸ごと差し替える。範囲選択中に「枠に触れた配線」を
   * 毎フレーム組み立て直すための入口（design.md §8.6）。
   * 1 本ずつのトグルでは、枠を縮めたときに外れた配線が選択に残る。
   */
  setSelectedConnections: (connectionIds: readonly string[]) => void;
  /** 同上、部品側 */
  setSelectedComponents: (componentIds: readonly string[]) => void;
  selectOnlyComponent: (componentId: string) => void;
  clearSelection: () => void;
  removeSelected: () => void;

  setViewport: (viewport: Viewport) => void;

  /**
   * ノードのドラッグ開始 / 終了。**履歴に積むのは終了時の 1 回だけ。**
   * 開始時点のドキュメントを控えておき、実際に位置が変わっていれば
   * それを past へ積む。掴んだだけ（位置が変わらない）なら何もしない。
   */
  beginComponentDrag: () => void;
  endComponentDrag: () => void;

  undo: () => void;
  redo: () => void;

  /**
   * 保存データの読み込みなど、ドキュメントを丸ごと差し替える。
   * **履歴と選択はリセットする** — 読み込み前の回路へ Undo で戻れてしまうと、
   * 「復元した」のか「壊した」のか分からなくなる。
   */
  replaceDocument: (document: CircuitDocument) => void;
};

const withSelected = (
  ids: readonly string[],
  id: string,
  selected: boolean,
): readonly string[] => {
  const has = ids.includes(id);
  if (selected === has) return ids;
  return selected ? [...ids, id] : ids.filter((current) => current !== id);
};

/**
 * 同じ ID 集合か（順序は問わない）。
 * 範囲選択中は毎フレーム選択を組み立て直すので、中身が同じなら
 * ここで弾いて再描画を止める（MY4N 1 個で端子 14 個ぶんの描画が走る）。
 */
const sameIds = (a: readonly string[], b: readonly string[]): boolean => {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
};

/** 存在しなくなった ID を選択から外す。変化が無ければ同じ配列を返す */
const retained = (
  ids: readonly string[],
  alive: ReadonlySet<string>,
): readonly string[] => {
  const next = ids.filter((id) => alive.has(id));
  return next.length === ids.length ? ids : next;
};

const idsOf = (document: CircuitDocument) => ({
  components: new Set(document.components.map((component) => component.id)),
  connections: new Set(document.connections.map((connection) => connection.id)),
});

/** 部品と配線をまとめて落とす。部品を消したらその端子に繋がる配線も道連れにする */
const removeFromDocument = (
  document: CircuitDocument,
  componentIds: ReadonlySet<string>,
  connectionIds: ReadonlySet<string>,
): CircuitDocument => ({
  ...document,
  components: document.components.filter(
    (component) => !componentIds.has(component.id),
  ),
  connections: document.connections.filter(
    (connection) =>
      !connectionIds.has(connection.id) &&
      !componentIds.has(connection.from.componentId) &&
      !componentIds.has(connection.to.componentId),
  ),
});

/** 部品の位置が 1 つでも動いたか（ドラッグ完了時に履歴を積むかの判定） */
const positionsChanged = (
  before: CircuitDocument,
  after: CircuitDocument,
): boolean =>
  before.components.length !== after.components.length ||
  before.components.some((component, index) => {
    const current = after.components[index];
    return (
      current === undefined ||
      current.id !== component.id ||
      current.position.x !== component.position.x ||
      current.position.y !== component.position.y
    );
  });

/**
 * ドラッグ開始時のドキュメント。
 *
 * ストアの state に置かない。履歴でも保存対象でもない一時値であり、
 * `document` の購読者を毎ドラッグで起こす理由が無い。
 */
let dragSnapshot: CircuitDocument | null = null;

export const useCircuitStore = create<CircuitStore>()((set, get) => {
  /** 履歴を 1 手進めて現在を差し替える */
  const commit = (state: CircuitStore, next: CircuitDocument) => ({
    document: next,
    past: [...state.past, state.document].slice(-HISTORY_LIMIT),
    // 新しい操作をした時点で、やり直しの枝は捨てる
    future: [] as readonly CircuitDocument[],
  });

  /** past / future を行き来する。**ビューポートは移動させない** */
  const travel = (state: CircuitStore, direction: "undo" | "redo") => {
    const target =
      direction === "undo" ? state.past.at(-1) : state.future.at(0);
    if (!target) return {};

    // 戻した瞬間にキャンバスが飛ばないよう、表示位置は今のものを保つ。
    // ビューポートは履歴の対象ではない（パン・ズームは操作の取り消し対象ではない）
    const document = { ...target, viewport: state.document.viewport };
    const alive = idsOf(document);

    return {
      document,
      past:
        direction === "undo" ? state.past.slice(0, -1) : [...state.past, state.document],
      future:
        direction === "undo"
          ? [state.document, ...state.future]
          : state.future.slice(1),
      selectedComponentIds: retained(
        state.selectedComponentIds,
        alive.components,
      ),
      selectedConnectionIds: retained(
        state.selectedConnectionIds,
        alive.connections,
      ),
    };
  };

  return {
    document: emptyDocument(),
    past: [],
    future: [],
    selectedComponentIds: [],
    selectedConnectionIds: [],

    addComponent: (definition, position) => {
      const id = createId("cmp");
      set((state) =>
        commit(state, {
          ...state.document,
          components: [
            ...state.document.components,
            {
              id,
              definitionId: definition.id,
              label: nextLabel(state.document, definition.category),
              position,
            },
          ],
        }),
      );
      return id;
    },

    // ドラッグ中は毎フレーム呼ばれる。履歴に積むのは endComponentDrag の 1 回だけ
    moveComponent: (componentId, position) =>
      set((state) => ({
        document: {
          ...state.document,
          components: state.document.components.map((component) =>
            component.id === componentId
              ? { ...component, position }
              : component,
          ),
        },
      })),

    applyLayout: (positions) => {
      if (positions.size === 0) return;
      set((state) => {
        let changed = false;
        const components = state.document.components.map((component) => {
          const position = positions.get(component.id);
          if (
            !position ||
            (position.x === component.position.x &&
              position.y === component.position.y)
          ) {
            return component;
          }
          changed = true;
          return { ...component, position };
        });
        // 空振り（存在しない ID・現在と同じ位置だけ）なら履歴を汚さない
        if (!changed) return {};
        return commit(state, { ...state.document, components });
      });
    },

    setComponentLabel: (componentId, label) => {
      // 入力値をそのまま持つ。ここで trim すると「RY 1」の途中（"RY "）で
      // 空白が消えてしまい、制御された input に文字が打てなくなる。
      // 前後の空白落としは入力欄を離れたときに UI 側が行う
      const next = label.trim() === "" ? undefined : label;
      set((state) => ({
        document: {
          ...state.document,
          components: state.document.components.map((component) =>
            component.id === componentId
              ? { ...component, label: next }
              : component,
          ),
        },
      }));
    },

    setComponentPreset: (componentId, presetMs) => {
      if (!Number.isFinite(presetMs)) return;
      set((state) => {
        let changed = false;
        const components = state.document.components.map((component) => {
          if (component.id !== componentId) return component;
          const electrical = getComponentDefinition(
            component.definitionId,
          )?.electrical;
          // タイマー以外には設定時間が無い。書き込むと誰も読まない値が残る
          if (electrical?.kind !== "relay" || !electrical.delay) return component;

          const next = presetMsOf(electrical.delay, presetMs);
          if (component.presetMs === next) return component;
          changed = true;
          return { ...component, presetMs: next };
        });
        // 同じ値への設定・タイマー以外への設定で履歴を汚さない
        if (!changed) return {};
        return commit(state, { ...state.document, components });
      });
    },

    setComponentChannelVolts: (componentId, channelId, volts) => {
      if (!Number.isFinite(volts)) return;
      set((state) => {
        let changed = false;
        const components = state.document.components.map((component) => {
          if (component.id !== componentId) return component;
          const electrical = getComponentDefinition(
            component.definitionId,
          )?.electrical;
          // 調光出力以外には出力電圧が無い。書き込むと誰も読まない値が残る
          if (electrical?.kind !== "analog-source") return component;
          // 定義に無いチャンネルへは書かない（保存 JSON に幽霊の回路を残さない）
          if (!electrical.channels.some((c) => c.id === channelId)) return component;

          const next = outputVoltsOf(electrical, volts);
          if (component.channelVolts?.[channelId] === next) return component;
          changed = true;
          return {
            ...component,
            channelVolts: { ...component.channelVolts, [channelId]: next },
          };
        });
        // 同じ値への設定・調光出力以外への設定で履歴を汚さない
        if (!changed) return {};
        return commit(state, { ...state.document, components });
      });
    },

    setComponentFadeMs: (componentId, fadeMs) => {
      if (!Number.isFinite(fadeMs)) return;
      set((state) => {
        let changed = false;
        const components = state.document.components.map((component) => {
          if (component.id !== componentId) return component;
          const electrical = getComponentDefinition(
            component.definitionId,
          )?.electrical;
          // フェードを持たない部品には書き込まない。誰も読まない値が残る
          if (electrical?.kind !== "analog-source" || !electrical.fade) {
            return component;
          }

          const next = fadeMsOf(electrical.fade, fadeMs);
          if (component.fadeMs === next) return component;
          changed = true;
          return { ...component, fadeMs: next };
        });
        // 同じ値への設定・フェードを持たない部品への設定で履歴を汚さない
        if (!changed) return {};
        return commit(state, { ...state.document, components });
      });
    },

    setComponentDimmerSettings: (componentId, patch) => {
      set((state) => {
        let changed = false;
        const components = state.document.components.map((component) => {
          if (component.id !== componentId) return component;
          const electrical = getComponentDefinition(
            component.definitionId,
          )?.electrical;
          const applies =
            electrical?.kind === "dimmer" ||
            (electrical?.kind === "lamp" && electrical.dimming !== undefined);
          // 調光入力を持たない部品には書き込まない
          if (!applies) return component;

          const next: DimmerSettings = { ...component.dimmerSettings, ...patch };
          const before: DimmerSettings = component.dimmerSettings ?? {};
          const keys = Object.keys(next) as (keyof DimmerSettings)[];
          const same =
            keys.length === Object.keys(before).length &&
            keys.every((key) => before[key] === next[key]);
          if (same) return component;
          changed = true;
          return { ...component, dimmerSettings: next };
        });
        if (!changed) return {};
        return commit(state, { ...state.document, components });
      });
    },

    setComponentLampColor: (componentId, color) => {
      if (!isLampColor(color)) return;
      set((state) => {
        let changed = false;
        const components = state.document.components.map((component) => {
          if (component.id !== componentId) return component;
          const electrical = getComponentDefinition(
            component.definitionId,
          )?.electrical;
          // ランプ以外にレンズは無い
          if (electrical?.kind !== "lamp") return component;

          // 既定色は持たない形に戻す（`flipped` と同じ）。保存 JSON に
          // 「既定と同じ値」を書き残すと、既定を変えたときに古い回路だけ取り残される
          const next = color === DEFAULT_LAMP_COLOR ? undefined : color;
          if (component.lampColor === next) return component;
          changed = true;
          const { lampColor: _dropped, ...rest } = component;
          return next === undefined ? rest : { ...rest, lampColor: next };
        });
        // 同じ色への設定・ランプ以外への設定で履歴を汚さない
        if (!changed) return {};
        return commit(state, { ...state.document, components });
      });
    },

    flipComponents: (componentIds) => {
      if (componentIds.length === 0) return;
      const targets = new Set(componentIds);
      set((state) => {
        let changed = false;
        const components = state.document.components.map((component) => {
          if (!targets.has(component.id)) return component;
          changed = true;
          // 反転していない状態は `flipped` を持たない形に戻す。
          // false を書き込むと保存 JSON に意味の無いフィールドが増える
          const flipped = component.flipped === true;
          return flipped
            ? { ...component, flipped: undefined }
            : { ...component, flipped: true };
        });
        // 選択が空振り（存在しない ID だけ）なら履歴を汚さない
        if (!changed) return {};
        return commit(state, { ...state.document, components });
      });
    },

    replaceComponentDefinition: (componentId, definition) => {
      set((state) => {
        const target = state.document.components.find(
          (component) => component.id === componentId,
        );
        if (!target || target.definitionId === definition.id) return {};

        const terminalIds = new Set(
          definition.terminals.map((terminal) => terminal.id),
        );
        const components = state.document.components.map((component) =>
          component.id === componentId
            ? { ...component, definitionId: definition.id }
            : component,
        );
        // 差し替え後に存在しない端子を指す配線だけを間引く。両端とも残っている
        // 配線には触れない — 接続はインスタンス ID を指すので、定義が変わっても
        // 端子 ID さえ一致すればつながったままでよい
        const connections = state.document.connections.filter((connection) => {
          if (
            connection.from.componentId === componentId &&
            !terminalIds.has(connection.from.terminalId)
          ) {
            return false;
          }
          if (
            connection.to.componentId === componentId &&
            !terminalIds.has(connection.to.terminalId)
          ) {
            return false;
          }
          return true;
        });

        const next = { ...state.document, components, connections };
        const alive = idsOf(next);
        return {
          ...commit(state, next),
          selectedConnectionIds: retained(
            state.selectedConnectionIds,
            alive.connections,
          ),
        };
      });
    },

    removeElements: (componentIds, connectionIds) => {
      if (componentIds.length + connectionIds.length === 0) return;
      set((state) => {
        const next = removeFromDocument(
          state.document,
          new Set(componentIds),
          new Set(connectionIds),
        );
        // 空振り（存在しない ID だけ）なら履歴を汚さない
        if (
          next.components.length === state.document.components.length &&
          next.connections.length === state.document.connections.length
        ) {
          return {};
        }
        const alive = idsOf(next);
        return {
          ...commit(state, next),
          selectedComponentIds: retained(
            state.selectedComponentIds,
            alive.components,
          ),
          selectedConnectionIds: retained(
            state.selectedConnectionIds,
            alive.connections,
          ),
        };
      });
    },

    addConnection: (params) => {
      const candidate = connectionFromReactFlow(params, createId("wire"));
      // 端子 → 端子 でない接続は表現しない（要件 US-B）
      if (!candidate) return;
      if (hasTerminalPair(get().document, candidate)) return;
      set((state) =>
        commit(state, {
          ...state.document,
          connections: [...state.document.connections, candidate],
        }),
      );
    },

    reconnectConnection: (connectionId, params) => {
      // 引き直した先の端子ペアを、**同じ ID の**接続として組み立てる
      const candidate = connectionFromReactFlow(params, connectionId);
      // 端子 → 端子 でない落とし先（部品本体・自己接続）は無視して元のまま残す
      if (!candidate) return;

      set((state) => {
        const current = state.document.connections.find(
          (connection) => connection.id === connectionId,
        );
        if (!current) return {};
        // 掴んで同じ端子へ戻しただけ。何も変わっていないので履歴を積まない
        if (isSameTerminalPair(current, candidate)) return {};
        // 引き直した先に既に同じ 1 本がある。重ねて張るのではなく元のまま残す
        // （自分自身は hasTerminalPair 側で除かれる）
        if (hasTerminalPair(state.document, candidate)) return {};

        return commit(state, {
          ...state.document,
          connections: state.document.connections.map((connection) =>
            connection.id === connectionId ? candidate : connection,
          ),
        });
      });
    },

    setComponentSelected: (componentId, selected) =>
      set((state) => {
        const next = withSelected(
          state.selectedComponentIds,
          componentId,
          selected,
        );
        return next === state.selectedComponentIds
          ? {}
          : { selectedComponentIds: next };
      }),

    setConnectionSelected: (connectionId, selected) =>
      set((state) => {
        const next = withSelected(
          state.selectedConnectionIds,
          connectionId,
          selected,
        );
        return next === state.selectedConnectionIds
          ? {}
          : { selectedConnectionIds: next };
      }),

    setSelectedConnections: (connectionIds) =>
      set((state) =>
        sameIds(state.selectedConnectionIds, connectionIds)
          ? {}
          : { selectedConnectionIds: [...connectionIds] },
      ),

    setSelectedComponents: (componentIds) =>
      set((state) =>
        sameIds(state.selectedComponentIds, componentIds)
          ? {}
          : { selectedComponentIds: [...componentIds] },
      ),

    // 警告一覧から該当部品へ飛ぶ操作。他の選択は解く（design.md §8.4）
    selectOnlyComponent: (componentId) =>
      set({
        selectedComponentIds: [componentId],
        selectedConnectionIds: [],
      }),

    clearSelection: () =>
      set({ selectedComponentIds: [], selectedConnectionIds: [] }),

    // 選択の削除も removeElements を通す。「配線を消してから部品を消す」と
    // 順に呼ぶと Undo 2 手ぶんの履歴になり、1 回の削除が 2 手で戻ることになる
    removeSelected: () => {
      const { selectedComponentIds, selectedConnectionIds, removeElements } =
        get();
      removeElements(selectedComponentIds, selectedConnectionIds);
    },

    setViewport: (viewport) =>
      set((state) => ({ document: { ...state.document, viewport } })),

    beginComponentDrag: () => {
      if (dragSnapshot) return;
      dragSnapshot = get().document;
    },

    endComponentDrag: () => {
      const snapshot = dragSnapshot;
      dragSnapshot = null;
      if (!snapshot) return;
      set((state) => {
        // 掴んだだけで動かしていないなら履歴を汚さない
        if (!positionsChanged(snapshot, state.document)) return {};
        return {
          past: [...state.past, snapshot].slice(-HISTORY_LIMIT),
          future: [],
        };
      });
    },

    undo: () => set((state) => travel(state, "undo")),
    redo: () => set((state) => travel(state, "redo")),

    replaceDocument: (document) => {
      dragSnapshot = null;
      set({
        document,
        past: [],
        future: [],
        selectedComponentIds: [],
        selectedConnectionIds: [],
      });
    },
  };
});
