"use client";

import "@xyflow/react/dist/style.css";

/**
 * キャンバス（中央カラム）。
 *
 * **真実は常に `circuitStore` の `CircuitDocument` 側にある。**
 * React Flow へ渡す nodes / edges はそこから毎回組み立てた派生データで、
 * React Flow が返す変更（移動・削除・選択・接続）は adapter を通して
 * ドキュメントへ書き戻す。React Flow 側に状態を持たせない（設計原則 4）。
 */

import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  ConnectionMode,
  Controls,
  Panel,
  ReactFlow,
  useReactFlow,
  useStoreApi,
} from "@xyflow/react";
import type {
  Connection,
  Edge,
  EdgeChange,
  Node,
  NodeChange,
  Viewport,
} from "@xyflow/react";
import { useCallback, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";

import {
  DEVICE_NODE_TYPE,
  WIRE_EDGE_TYPE,
  canConnectTerminals,
  toDeviceNodes,
  toWireEdges,
} from "@/circuit/adapter/reactflow";
import type { DeviceNode as DeviceNodeType } from "@/circuit/adapter/reactflow";
import { buildCurrentFlow } from "@/circuit/adapter/current-flow";
import { buildSelfHold } from "@/circuit/adapter/self-hold";
import { buildSimulationView } from "@/circuit/adapter/simulation-view";
import type { WireState } from "@/circuit/adapter/simulation-view";
import { buildTerminalConnections } from "@/circuit/adapter/terminal-connections";
import { buildWireLanes } from "@/circuit/adapter/wire-lane";
import { buildWireRoles } from "@/circuit/adapter/wire-role";
import type { WireRole } from "@/circuit/adapter/wire-role";
import { componentRegistry, getComponentDefinition } from "@/circuit/definitions";
import { WIRE_RECONNECT_RADIUS, WireEdge } from "@/components/edges/WireEdge";
import { DeviceNode } from "@/components/nodes/DeviceNode";
import {
  DELETE_KEYS,
  MULTI_SELECT_KEYS,
  PAN_ACTIVATION_KEY,
  PAN_BUTTONS,
} from "@/lib/shortcuts";
import { useCircuitStore } from "@/store/circuitStore";
import { useSimulationStore } from "@/store/simulationStore";

import { readDefinitionId } from "./palette-dnd";
import type { RangeSelectionTarget } from "./range-selection";
import { useCoarsePointer, useCompactLayout } from "./useViewportMode";
import { useRangeSelection } from "./useRangeSelection";
import { usePathPreview } from "./usePathPreview";
import { WireLegend } from "./WireLegend";
import styles from "./CircuitCanvas.module.css";

/**
 * 端子に吸い付く距離（`ReactFlow.connectionRadius`）。指では既定の 20px では
 * 足りない —— 指先の当たり判定（およそ 40px）の中に端子が複数入るので、
 * 狙った端子の手前で線が離れる（design.md §8.12）。
 */
const TOUCH_CONNECTION_RADIUS = 32;

/** 部品はすべて 1 種類のノードで描く（design.md §2）。再生成しないよう外に置く */
const nodeTypes = { [DEVICE_NODE_TYPE]: DeviceNode };

/** 配線も 1 種類。折れる位置をずらして重なりを解く（design.md §8.7） */
const edgeTypes = { [WIRE_EDGE_TYPE]: WireEdge };

/**
 * ホバー中の配線を持ち上げる高さ。
 *
 * Edge は 1 本ずつ別の `<svg>` に描かれるので、`zIndex` を上げると縁取り
 * （`WireEdge.module.css` の halo）が他の線の上に出て、交差した束の中から
 * 1 本だけを抜き出して見せられる。選択中の配線は React Flow の
 * `elevateEdgesOnSelect` が同じことを +1000 で行うので、それより上に置く。
 */
const HOVERED_WIRE_Z = 2000;

/**
 * 配線の重ね順（design.md §8.7）。
 *
 * 同じ座標を走る配線は重なり、**後に描かれた 1 本しか見えない。** レーン分離で
 * 離せる重なりは離すが、それでも交差点は必ず残る。そこで
 * **「隠されると情報そのものが消える線」ほど前面**に置く。
 *
 * これは §5.6 の判定順（最も危険な配線ミスを最も安全な見た目にしない）を
 * 描画順へ延長したもの。実線に覆われた流れる線は「電流の向きが分からない」
 * ではなく「向きが無い線」に見えてしまうので、色の判定順と同じ扱いが要る。
 */
const WIRE_Z = {
  /** 電源短絡。交差点でも必ず見える */
  short: 4,
  /**
   * 隠れると情報が消える線 —— 電流の向きの切れ目（§5.10）・自己保持の破線
   * （§5.9）・配線漏れの破線（§5.8）。どれも模様そのものが意味を持つ
   */
  patterned: 3,
  /** 生きている閉回路。待機線より前に出す */
  energized: 2,
  /** 待機線・役割色。既定 */
  base: 0,
} as const;

/**
 * キー割り当ての実体は `lib/shortcuts.ts` にある（design.md §8.10）。
 * ヘルプの表を同じ定数から組み立てるための集約で、意味は次のとおり。
 *
 * - `DELETE_KEYS` —— Delete / Backspace に加えて **D 単独**。
 *   **入力欄では発火しない。** React Flow の `deleteKeyCode` は
 *   `useKeyPress(..., { actInsideInputWithModifier: false })` 経由で
 *   `isInputDOMNode()` を見ており、修飾キー無しの打鍵が input / textarea /
 *   contenteditable に入っているときは無視される。部品名やパレット検索に
 *   "d" を打っても回路は消えない
 * - `PAN_ACTIVATION_KEY` —— 押している間だけ `panOnDrag` を有効にするキー
 *   （既定は Space）。Shift にすることで **Shift+左ドラッグ＝パン**、
 *   素の左ドラッグ＝範囲選択になる。**`selectionKeyCode` は同時に外すこと。**
 *   既定では Shift が範囲選択キーで、両方に Shift を割り当てると React Flow は
 *   `panOnDrag: !selectionKeyPressed && panOnDrag` でパンを打ち消す
 * - `PAN_BUTTONS` —— 左ボタンは範囲選択の枠に取られるので中・右ボタンへ逃がす
 */

/**
 * 配線の表示状態 → CSS Modules のクラス（design.md §5.6）。
 *
 * React Flow は Edge の `className` を `<g class="react-flow__edge ...">` に
 * 載せるので、ハッシュ済みのモジュールクラスをここで解決して渡す。
 * 非通電（`inactive`）も色は既定の灰のままだが、**実行中だけ濃さを落とす**
 * ためにクラスを持つ（停止中の役割色と同じ灰にしてしまわない）。
 */
const WIRE_CLASS: Record<WireState, string | undefined> = {
  inactive: styles.wireInactive,
  plus: styles.wirePlus,
  zero: styles.wireZero,
  energized: styles.wireEnergized,
  "self-hold": styles.wireSelfHold,
  short: styles.wireShort,
};

/**
 * 停止中の役割 → クラス（design.md §5.8）。
 *
 * 短絡だけは実行中と同じ `wireShort` を使い回す。停止中に見つかった短絡を
 * 大人しい色にすると、実行した瞬間に色が変わって初めて気付くことになる。
 */
const WIRE_ROLE_CLASS: Record<WireRole, string | undefined> = {
  plus: styles.wireRolePlus,
  zero: styles.wireRoleZero,
  control: styles.wireRoleControl,
  isolated: styles.wireRoleIsolated,
  short: styles.wireShort,
};

/**
 * 部品が 1 つも無いときの案内文。
 *
 * **書き分ける軸は 2 つある**（design.md §8.12）。部品の置き方は入力の種類
 * （掴めるか・タップか）で決まり、パレットの在り処は画面の広さ（左の
 * カラムか、下のシートか）で決まる。片方だけで文を選ぶと、指で操作できる
 * タブレットに「左のパレットからドラッグ」と出て、そのとおりにしても
 * 何も起きない。
 */
const emptyHint = (coarse: boolean, compact: boolean): string => {
  const palette = compact ? "画面下の「部品」" : "左のパレット";
  // 置き方はパレットの実装に合わせる。シートのパレットは指でもマウスでも
  // タップで置く（`CircuitWorkspace` が `onPick` を渡している）
  const place =
    compact || coarse
      ? `${palette}から部品をタップして置き`
      : `${palette}から部品をドラッグして配置し`;
  const view = coarse
    ? "1 本指で画面移動、2 本指で拡大・縮小。"
    : "何もない所をドラッグすると範囲選択、Shift+ドラッグで画面を動かせます。";
  const help = compact
    ? "操作の一覧は操作バーの ? から。"
    : "操作の一覧は右上の ? から。";

  return `${place}、端子（小さな丸）どうしをドラッグして配線します。${view}${help}`;
};

export type CircuitCanvasProps = {
  /** 範囲選択が拾う対象（部品＋配線 / 部品のみ / 配線のみ） */
  rangeSelectionTarget: RangeSelectionTarget;
};

export function CircuitCanvas({ rangeSelectionTarget }: CircuitCanvasProps) {
  const { screenToFlowPosition } = useReactFlow();

  /**
   * 指で触っているか（design.md §8.12）。**ドラッグの割り当てが変わる。**
   * マウスでは素の左ドラッグを範囲選択に取っているが（§8.6）、指には
   * Shift も中ボタンも無く、そのままでは**画面をまったく動かせない。**
   */
  const coarse = useCoarsePointer();
  // 狭い画面では凡例を畳み、ズーム操作を下から上へ逃がす（シートに隠れるため）
  const compact = useCompactLayout();
  // 範囲選択の枠を「今まさに引いているか」をイベント時にその場で読むため。
  // state として購読するとドラッグ 1 フレームごとにハンドラーが作り直される
  const flowStore = useStoreApi();

  // 枠に触れた配線の選択はこちらが持つ（React Flow は配線を枠で選べない）
  useRangeSelection(rangeSelectionTarget);

  const document = useCircuitStore((state) => state.document);
  const selectedComponentIds = useCircuitStore(
    (state) => state.selectedComponentIds,
  );
  const selectedConnectionIds = useCircuitStore(
    (state) => state.selectedConnectionIds,
  );

  const addComponent = useCircuitStore((state) => state.addComponent);
  const moveComponent = useCircuitStore((state) => state.moveComponent);
  const removeElements = useCircuitStore((state) => state.removeElements);
  const addConnection = useCircuitStore((state) => state.addConnection);
  const reconnectConnection = useCircuitStore(
    (state) => state.reconnectConnection,
  );
  const setComponentSelected = useCircuitStore(
    (state) => state.setComponentSelected,
  );
  const setConnectionSelected = useCircuitStore(
    (state) => state.setConnectionSelected,
  );
  const setViewport = useCircuitStore((state) => state.setViewport);
  const beginComponentDrag = useCircuitStore(
    (state) => state.beginComponentDrag,
  );
  const endComponentDrag = useCircuitStore((state) => state.endComponentDrag);

  const result = useSimulationStore((state) => state.result);
  const pressedSwitches = useSimulationStore((state) => state.pressedSwitches);
  const nowMs = useSimulationStore((state) => state.nowMs);
  const pathPreview = useSimulationStore((state) => state.pathPreview);

  /**
   * 自己保持の検出（design.md §5.9）。励磁中のリレー 1 個につき `simulate()` を
   * 1 回追加で回すので、`view` とは別の useMemo に分けて **結果が変わったときだけ**
   * 走らせる。部品をドラッグしただけの再描画では走らない。
   */
  const selfHold = useMemo(
    () => buildSelfHold(document, componentRegistry, result, pressedSwitches),
    [document, result, pressedSwitches],
  );

  // 停止中は result が null で、ビューは空＝すべて非通電として描かれる。
  // `nowMs` は `result` を解いた時刻で、タイマーの残り時間の算出だけに使う
  // （ここでも時計は読まない・design.md §5.13）
  const view = useMemo(
    () =>
      buildSimulationView(
        document,
        componentRegistry,
        result,
        pressedSwitches,
        selfHold,
        nowMs,
      ),
    [document, result, pressedSwitches, selfHold, nowMs],
  );

  /**
   * 経路確認モードの表示状態（design.md §5.15・§8.14）。
   *
   * 解くのは `usePathPreview` 1 箇所で、**一覧（`PathPreviewList`）と同じ
   * 結果を読む** —— 色と文言が別々の解を指すと、画面で止まっている場所と
   * 一覧に並ぶ場所が食い違う。モードに入っていない間は空を返す。
   */
  const preview = usePathPreview();

  // 端子ツールチップの接続先（design.md §8.3）。実行中かどうかに関わらず
  // 配線そのものから決まるので、シミュレーションビューとは別に組み立てる
  const terminalConnections = useMemo(
    () => buildTerminalConnections(document, componentRegistry),
    [document],
  );

  const nodes = useMemo(
    () =>
      toDeviceNodes(
        document,
        componentRegistry,
        selectedComponentIds,
        // 経路確認中は予測の端子色を描く。`deviceOf` は空なので、
        // 部品そのものは「動いていない」ままになる（`path-preview.ts`）
        pathPreview ? preview.view : view,
        terminalConnections,
        /*
          経路確認中だけ渡す。**渡すこと自体がモードの合図**で、
          スイッチはこれを見て倒す操作子を出す（`SwitchBody`・§8.14）。
          モード外で渡すと、停止中の図面にボタンが並ぶ。
        */
        pathPreview
          ? {
              blocked: preview.blockedComponentIds,
              operated: pressedSwitches,
            }
          : undefined,
      ),
    [
      document,
      pathPreview,
      preview,
      pressedSwitches,
      selectedComponentIds,
      view,
      terminalConnections,
    ],
  );
  /**
   * 配線の役割（design.md §5.8）。**実行中も計算する。**
   *
   * 色として使うのは停止中だけ —— 実行中の色は実際の電位（`view`）で決まり、
   * 役割色を混ぜると同じ線に 2 つの意味が載る。実行中に借りるのは
   * `isolated`（どう動作させても電源に届かない）の 1 ビットだけで、
   * 用途も色ではなく破線というパターンに限る。実行した瞬間に配線漏れの
   * 手がかりが消えないようにするため。
   *
   * ドキュメントが変わるたびに組み直すので、部品をドラッグしている間も毎フレーム
   * 走る。ネット構築は端子数に線形の Union-Find（数百端子で数十マイクロ秒）で、
   * 同じ useMemo 群にいる `toDeviceNodes` より軽いため、キャッシュを足していない。
   */
  const wireRoles = useMemo(
    () => buildWireRoles(document, componentRegistry),
    [document],
  );

  /**
   * 配線の重なりを解くための幹線のずらし量（design.md §8.7）。
   *
   * `wireRoles` と違い**実行中も計算する。** 線が重なって読めない問題は
   * 動かしているかどうかと関係なく起きる。計算量も端子数に線形で、
   * 同じ useMemo 群の `toDeviceNodes` より軽い。
   */
  const wireLanes = useMemo(
    () => buildWireLanes(document, componentRegistry),
    [document],
  );

  /**
   * 電流の向き（design.md §5.10）。**停止中は計算しない** —— 動かしていない
   * 回路に電流は流れておらず、`buildCurrentFlow` が空を返す。
   *
   * 経路グラフと橋の計算は回路につき 1 回で、計算量は端子数・配線数に線形。
   * `selfHold` と同じ道具を使うが、問いが別（保持しているか / どちらへ流れるか）
   * なので別の useMemo に置く。
   */
  const currentFlow = useMemo(
    () => buildCurrentFlow(document, componentRegistry, result, pressedSwitches),
    [document, result, pressedSwitches],
  );

  // ホバー中の 1 本だけを最前面へ出すための表示状態。回路の一部ではないので
  // circuitStore（保存対象＋履歴）には入れない
  const [hoveredWireId, setHoveredWireId] = useState<string | null>(null);

  const edges = useMemo(
    () =>
      toWireEdges(
        document,
        selectedConnectionIds,
        wireLanes,
        currentFlow,
      ).map((edge) => {
        const hovered = edge.id === hoveredWireId;
        const role = wireRoles.get(edge.id);

        if (pathPreview) {
          /*
           * 経路確認モード（design.md §8.14）。**実行中と同じ状態色を使う。**
           * 予測であることは色ではなく描き方（破線・発光なし）で表し、
           * それは `.canvas[data-path-preview]` の CSS が受け持つ。ここで
           * 予測専用のクラスを配ると、同じ意味の色が 2 系統になる。
           *
           * 役割色（`wireRoles`）とは**排他**。4 色＋4 色が同時に載ると、
           * どちらの軸で読めばよいのかが線から分からなくなる。
           */
          const state = preview.view.wireOf.get(edge.id) ?? "inactive";
          return {
            ...edge,
            zIndex: hovered
              ? HOVERED_WIRE_Z
              : state === "short"
                ? WIRE_Z.short
                : state === "energized"
                  ? WIRE_Z.energized
                  : WIRE_Z.base,
            className: WIRE_CLASS[state],
          };
        }

        if (!result) {
          /*
           * 停止中の重ね順。短絡が最前面、次が配線漏れの破線 —— どちらも
           * 隠されると気付けない。制御線・電源線は既定のままでよい
           */
          const roleZ =
            role === "short"
              ? WIRE_Z.short
              : role === "isolated"
                ? WIRE_Z.patterned
                : WIRE_Z.base;
          return {
            ...edge,
            zIndex: hovered ? HOVERED_WIRE_Z : roleZ,
            className: role ? WIRE_ROLE_CLASS[role] : undefined,
          };
        }

        const state = view.wireOf.get(edge.id) ?? "inactive";
        /*
         * 実行中に破線を足すのは **今も届いておらず、どう動作させても届かない**
         * 線だけ。役割の判定は 3 状態しか見ない近似なので（§5.8）、
         * 「あるリレーは励磁し、別のリレーは非励磁」でしか電源に届かない線を
         * `isolated` と誤ることがある。今まさに電位が乗っている線に
         * 「配線漏れ」の破線を引くのは明白な矛盾なので、食い違ったら
         * 現在の状態を優先する。
         */
        const unreachable = state === "inactive" && role === "isolated";
        const className = unreachable
          ? `${styles.wireInactive} ${styles.wireUnreachable}`
          : WIRE_CLASS[state];

        /*
         * 実行中の重ね順。模様（切れ目・破線）が意味を持つ線を、
         * のっぺりした実線より前に出す。**実線に覆われた流れる線は
         * 「向きが分からない」ではなく「向きが無い」に見える。**
         */
        const stateZ =
          state === "short"
            ? WIRE_Z.short
            : state === "self-hold" || unreachable || edge.data?.flow
              ? WIRE_Z.patterned
              : state === "energized"
                ? WIRE_Z.energized
                : WIRE_Z.base;

        return {
          ...edge,
          zIndex: hovered ? HOVERED_WIRE_Z : stateZ,
          className,
          /*
           * 自己保持の紫は線自身が流れる破線（§5.9）。そこへ切れ目の
           * オーバーレイを重ねると**周期の違う破線が 2 つ重なり、模様が壊れる。**
           * 向きは線の `animation-direction` に任せる（§5.10）。
           *
           * 破線を持つ他の状態（`wireUnreachable` / `wireShort`）は
           * そもそも通電していないので `flow` を持たず、ここには来ない。
           */
          data: { ...edge.data, flowOnStroke: state === "self-hold" },
        };
      }),
    [
      currentFlow,
      document,
      hoveredWireId,
      pathPreview,
      preview,
      result,
      selectedConnectionIds,
      view,
      wireLanes,
      wireRoles,
    ],
  );

  const onEdgeMouseEnter = useCallback(
    (_event: unknown, edge: Edge) => setHoveredWireId(edge.id),
    [],
  );
  const onEdgeMouseLeave = useCallback(() => setHoveredWireId(null), []);

  const onNodesChange = useCallback(
    (changes: NodeChange<DeviceNodeType>[]) => {
      // 枠を引いている間の選択は useRangeSelection が丸ごと決める（design.md §8.6）。
      // React Flow の判定を混ぜると、枠に触れただけの配線が次のフレームで外れ、
      // 「配線のみ」で外したはずの部品が選択に戻る
      const ranging = flowStore.getState().userSelectionRect !== null;

      for (const change of changes) {
        switch (change.type) {
          case "position":
            // ドラッグ中は毎フレーム来る。Undo 履歴に積むのは
            // ここではなく onNodeDragStart / Stop の対（design.md §7）
            if (change.position) moveComponent(change.id, change.position);
            break;
          case "select":
            if (!ranging) setComponentSelected(change.id, change.selected);
            break;
          default:
            // remove は onDelete が 1 回でまとめて受ける（下記）。
            // dimensions / add / replace はドキュメントに影響しない
            break;
        }
      }
    },
    [flowStore, moveComponent, setComponentSelected],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      // 上と同じ理由で、枠を引いている間は useRangeSelection に任せる
      if (flowStore.getState().userSelectionRect !== null) return;

      for (const change of changes) {
        if (change.type === "select") {
          setConnectionSelected(change.id, change.selected);
        }
      }
    },
    [flowStore, setConnectionSelected],
  );

  /**
   * 削除は **ここ 1 か所で 1 手にまとめる。**
   *
   * React Flow は削除を「Edge の remove 変更」と「Node の remove 変更」に分けて
   * 流すので、変更ハンドラー側で消すと範囲選択で 5 個消したときに履歴が 5 手積まれ、
   * 戻すのに 5 回 Undo が要る。`onDelete` は両方が揃った状態で 1 回だけ呼ばれる。
   */
  const onDelete = useCallback(
    ({ nodes: removedNodes, edges: removedEdges }: {
      nodes: Node[];
      edges: Edge[];
    }) => {
      removeElements(
        removedNodes.map((node) => node.id),
        removedEdges.map((edge) => edge.id),
      );
    },
    [removeElements],
  );

  const onConnect = useCallback(
    (connection: Connection) => addConnection(connection),
    [addConnection],
  );

  /**
   * つなぎ替え中の配線 ID（design.md §8.8）。
   *
   * **state ではなく ref で持つ。** これを見るのはドラッグ中に毎フレーム呼ばれる
   * `isValidConnection` で、state にすると掴んだ瞬間にハンドラーが作り直され、
   * React Flow が握っている `isValidConnection` が古いままになる恐れがある。
   * 表示にも使わないので再描画する理由が無い。
   */
  const reconnectingWireId = useRef<string | null>(null);

  const onReconnectStart = useCallback((_event: unknown, edge: Edge) => {
    reconnectingWireId.current = edge.id;
  }, []);

  const onReconnect = useCallback(
    (oldEdge: Edge, connection: Connection) =>
      reconnectConnection(oldEdge.id, connection),
    [reconnectConnection],
  );

  /**
   * 掴んだ端を離したとき。**接続先が無ければ配線は元のまま残す。**
   * 空きスペースへ落として消える仕様にすると、掴み損ねただけで配線が消える。
   * 削除は Delete / D（`DELETE_KEYS`）という別の操作に任せる。
   */
  const onReconnectEnd = useCallback(() => {
    reconnectingWireId.current = null;
  }, []);

  const isValidConnection = useCallback(
    (params: Connection | Edge) =>
      canConnectTerminals(
        document,
        params,
        reconnectingWireId.current ?? undefined,
      ),
    [document],
  );

  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const definitionId = readDefinitionId(event.dataTransfer);
      if (!definitionId) return;
      const definition = getComponentDefinition(definitionId);
      if (!definition) return;

      const dropped = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      // ドロップ地点が部品の中心に来るように左上へ寄せる
      addComponent(definition, {
        x: dropped.x - definition.visual.width / 2,
        y: dropped.y - definition.visual.height / 2,
      });
    },
    [addComponent, screenToFlowPosition],
  );

  const onMoveEnd = useCallback(
    (_event: unknown, viewport: Viewport) => setViewport(viewport),
    [setViewport],
  );

  return (
    <div
      className={styles.canvas}
      data-compact={compact || undefined}
      // 経路確認モード（design.md §8.14）。予測であることを線の描き方で表す
      data-path-preview={pathPreview || undefined}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <ReactFlow<DeviceNodeType>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        // 重なった束の中から 1 本を拾うための強調（design.md §8.7）。
        // ホバーは自前で持ち上げ、選択は React Flow に持ち上げてもらう
        onEdgeMouseEnter={onEdgeMouseEnter}
        onEdgeMouseLeave={onEdgeMouseLeave}
        elevateEdgesOnSelect
        // 履歴のスナップショットはドラッグの前後 1 対だけ取る（design.md §7）。
        // 位置そのものは onNodesChange が毎フレーム書き込んでいる
        onNodeDragStart={beginComponentDrag}
        onNodeDragStop={endComponentDrag}
        onDelete={onDelete}
        onConnect={onConnect}
        // 既存の配線の端を掴んで引き直す（design.md §8.8）。
        // onReconnect を渡して初めて端の掴み手が現れる
        onReconnectStart={onReconnectStart}
        onReconnect={onReconnect}
        onReconnectEnd={onReconnectEnd}
        reconnectRadius={WIRE_RECONNECT_RADIUS}
        connectionRadius={coarse ? TOUCH_CONNECTION_RADIUS : undefined}
        isValidConnection={isValidConnection}
        onMoveEnd={onMoveEnd}
        defaultViewport={document.viewport}
        // 端子に「入力 / 出力」の区別は無い。Loose にすることで
        // どの端子からどの端子へでもドラッグできる（design.md §8.1）
        connectionMode={ConnectionMode.Loose}
        connectionLineType={ConnectionLineType.SmoothStep}
        deleteKeyCode={DELETE_KEYS}
        /*
         * マウス: 左ドラッグ＝範囲選択、Shift+ドラッグ＝パン、
         * Ctrl/Cmd+クリック＝複数選択（design.md §8.6）。パンを Shift へ移したので、
         * 端子を掴み損ねて枠が出ても画面移動の手段は常に残る。
         *
         * 指: **1 本指のドラッグは画面移動**（design.md §8.12）。指には Shift も
         * 中ボタンも無いので、範囲選択に割り当てたままだと図面を動かせない。
         * 拡大・縮小は 2 本指（`zoomOnPinch` は既定で有効）。
         * 範囲選択が使えなくなるぶん、操作バーの対象切り替えも隠す
         */
        selectionOnDrag={!coarse}
        selectionKeyCode={null}
        panActivationKeyCode={PAN_ACTIVATION_KEY}
        panOnDrag={coarse ? true : PAN_BUTTONS}
        multiSelectionKeyCode={MULTI_SELECT_KEYS}
        panOnScroll
        minZoom={0.2}
        maxZoom={2.5}
        nodeOrigin={[0, 0]}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        {/*
          ズーム操作。狭い画面では**下から出るシートに隠れる**ので左上へ逃がす
          （design.md §8.12）。指では 2 本指のピンチが本命だが、片手で持って
          いるときにボタンで寄れる経路は残す
        */}
        <Controls
          showInteractive={false}
          position={compact ? "top-left" : "bottom-left"}
        />
        {/* 凡例は停止中・実行中の両方で出す。中身は色の意味に合わせて入れ替わる */}
        {document.connections.length > 0 && (
          <Panel position="bottom-right">
            {/*
              狭い画面では凡例を畳んでおく（design.md §8.12）。6 項目を広げると
              携帯の画面では図面の 3 分の 1 を覆う。色の意味は必要になったときに
              開けばよいが、**畳んでも「凡例がある」ことは見せ続ける**
            */}
            <WireLegend
              running={result !== null}
              pathPreview={pathPreview}
              collapsible={compact}
            />
          </Panel>
        )}
        {document.components.length === 0 && (
          <Panel position="top-center">
            <p className={styles.emptyHint}>{emptyHint(coarse, compact)}</p>
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}
