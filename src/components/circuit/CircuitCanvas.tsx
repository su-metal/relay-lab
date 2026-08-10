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
import { useRangeSelection } from "./useRangeSelection";
import { WireLegend } from "./WireLegend";
import styles from "./CircuitCanvas.module.css";

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

export type CircuitCanvasProps = {
  /** 範囲選択が拾う対象（部品＋配線 / 部品のみ / 配線のみ） */
  rangeSelectionTarget: RangeSelectionTarget;
};

export function CircuitCanvas({ rangeSelectionTarget }: CircuitCanvasProps) {
  const { screenToFlowPosition } = useReactFlow();
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

  /**
   * 自己保持の検出（design.md §5.9）。励磁中のリレー 1 個につき `simulate()` を
   * 1 回追加で回すので、`view` とは別の useMemo に分けて **結果が変わったときだけ**
   * 走らせる。部品をドラッグしただけの再描画では走らない。
   */
  const selfHold = useMemo(
    () => buildSelfHold(document, componentRegistry, result, pressedSwitches),
    [document, result, pressedSwitches],
  );

  // 停止中は result が null で、ビューは空＝すべて非通電として描かれる
  const view = useMemo(
    () =>
      buildSimulationView(
        document,
        componentRegistry,
        result,
        pressedSwitches,
        selfHold,
      ),
    [document, result, pressedSwitches, selfHold],
  );

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
        view,
        terminalConnections,
      ),
    [document, selectedComponentIds, view, terminalConnections],
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
        const zIndex = edge.id === hoveredWireId ? HOVERED_WIRE_Z : undefined;
        const role = wireRoles.get(edge.id);

        if (!result) {
          return {
            ...edge,
            zIndex,
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
        const className =
          state === "inactive" && role === "isolated"
            ? `${styles.wireInactive} ${styles.wireUnreachable}`
            : WIRE_CLASS[state];
        return { ...edge, zIndex, className };
      }),
    [
      currentFlow,
      document,
      hoveredWireId,
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
    <div className={styles.canvas} onDragOver={onDragOver} onDrop={onDrop}>
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
        isValidConnection={isValidConnection}
        onMoveEnd={onMoveEnd}
        defaultViewport={document.viewport}
        // 端子に「入力 / 出力」の区別は無い。Loose にすることで
        // どの端子からどの端子へでもドラッグできる（design.md §8.1）
        connectionMode={ConnectionMode.Loose}
        connectionLineType={ConnectionLineType.SmoothStep}
        deleteKeyCode={DELETE_KEYS}
        // 左ドラッグ＝範囲選択、Shift+ドラッグ＝パン、Ctrl/Cmd+クリック＝複数選択
        // （design.md §8.6）。パンを Shift へ移したので、端子を掴み損ねて枠が出ても
        // 画面移動の手段は常に残る
        selectionOnDrag
        selectionKeyCode={null}
        panActivationKeyCode={PAN_ACTIVATION_KEY}
        panOnDrag={PAN_BUTTONS}
        multiSelectionKeyCode={MULTI_SELECT_KEYS}
        panOnScroll
        minZoom={0.2}
        maxZoom={2.5}
        nodeOrigin={[0, 0]}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        <Controls showInteractive={false} />
        {/* 凡例は停止中・実行中の両方で出す。中身は色の意味に合わせて入れ替わる */}
        {document.connections.length > 0 && (
          <Panel position="bottom-right">
            <WireLegend running={result !== null} />
          </Panel>
        )}
        {document.components.length === 0 && (
          <Panel position="top-center">
            <p className={styles.emptyHint}>
              左のパレットから部品をドラッグして配置し、端子（小さな丸）どうしをドラッグして配線します。何もない所をドラッグすると範囲選択、
              Shift+ドラッグで画面を動かせます。操作の一覧は右上の ? から。
            </p>
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}
