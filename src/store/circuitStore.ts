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
} from "@/circuit/adapter/reactflow";
import type {
  CircuitDocument,
  ComponentCategory,
  ComponentDefinition,
} from "@/circuit/types";
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
  removeComponents: (componentIds: readonly string[]) => void;

  /**
   * インスタンスのラベル（"RY1"）を変更する。空文字は未設定（`undefined`）に戻す。
   *
   * 1 文字ごとに発火するので **Undo 履歴には積まない**（スナップショット地点は
   * 部品追加 / 削除 / 配線確定 / ドラッグ完了 の 4 点。design.md §7）。
   */
  setComponentLabel: (componentId: string, label: string) => void;

  /**
   * React Flow の接続イベントから配線を足す。
   * 端子以外への接続と重複配線はここで捨てる（adapter が判定する）。
   */
  addConnection: (params: Connection) => void;
  removeConnections: (connectionIds: readonly string[]) => void;

  setComponentSelected: (componentId: string, selected: boolean) => void;
  setConnectionSelected: (connectionId: string, selected: boolean) => void;
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

    removeComponents: (componentIds) => {
      if (componentIds.length === 0) return;
      const removed = new Set(componentIds);
      set((state) => {
        const next = removeFromDocument(state.document, removed, new Set());
        if (next.components.length === state.document.components.length) {
          return {};
        }
        return {
          ...commit(state, next),
          selectedComponentIds: retained(
            state.selectedComponentIds,
            new Set(next.components.map((component) => component.id)),
          ),
          selectedConnectionIds: retained(
            state.selectedConnectionIds,
            new Set(next.connections.map((connection) => connection.id)),
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

    removeConnections: (connectionIds) => {
      if (connectionIds.length === 0) return;
      const removed = new Set(connectionIds);
      set((state) => {
        const next = removeFromDocument(state.document, new Set(), removed);
        if (next.connections.length === state.document.connections.length) {
          return {};
        }
        return {
          ...commit(state, next),
          selectedConnectionIds: retained(
            state.selectedConnectionIds,
            new Set(next.connections.map((connection) => connection.id)),
          ),
        };
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

    // 警告一覧から該当部品へ飛ぶ操作。他の選択は解く（design.md §8.4）
    selectOnlyComponent: (componentId) =>
      set({
        selectedComponentIds: [componentId],
        selectedConnectionIds: [],
      }),

    clearSelection: () =>
      set({ selectedComponentIds: [], selectedConnectionIds: [] }),

    // 部品と配線を 1 回の操作として消す。removeConnections → removeComponents と
    // 順に呼ぶと Undo 2 回分の履歴になり、1 回の削除が 2 手で戻ることになる
    removeSelected: () => {
      const { selectedComponentIds, selectedConnectionIds } = get();
      if (selectedComponentIds.length + selectedConnectionIds.length === 0) {
        return;
      }
      set((state) => {
        const next = removeFromDocument(
          state.document,
          new Set(selectedComponentIds),
          new Set(selectedConnectionIds),
        );
        if (
          next.components.length === state.document.components.length &&
          next.connections.length === state.document.connections.length
        ) {
          return {};
        }
        return {
          ...commit(state, next),
          selectedComponentIds: [],
          selectedConnectionIds: [],
        };
      });
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
