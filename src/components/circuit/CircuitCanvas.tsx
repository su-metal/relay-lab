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
} from "@xyflow/react";
import type {
  Connection,
  Edge,
  EdgeChange,
  NodeChange,
  Viewport,
} from "@xyflow/react";
import { useCallback, useMemo } from "react";
import type { DragEvent } from "react";

import {
  DEVICE_NODE_TYPE,
  canConnectTerminals,
  toDeviceNodes,
  toWireEdges,
} from "@/circuit/adapter/reactflow";
import type { DeviceNode as DeviceNodeType } from "@/circuit/adapter/reactflow";
import { buildSimulationView } from "@/circuit/adapter/simulation-view";
import type { WireState } from "@/circuit/adapter/simulation-view";
import { componentRegistry, getComponentDefinition } from "@/circuit/definitions";
import { DeviceNode } from "@/components/nodes/DeviceNode";
import { useCircuitStore } from "@/store/circuitStore";
import { useSimulationStore } from "@/store/simulationStore";

import { readDefinitionId } from "./palette-dnd";
import styles from "./CircuitCanvas.module.css";

/** 部品はすべて 1 種類のノードで描く（design.md §2）。再生成しないよう外に置く */
const nodeTypes = { [DEVICE_NODE_TYPE]: DeviceNode };

/** Delete / Backspace のどちらでも削除できるようにする */
const DELETE_KEYS = ["Delete", "Backspace"];

/**
 * 配線の表示状態 → CSS Modules のクラス（design.md §5.6）。
 *
 * React Flow は Edge の `className` を `<g class="react-flow__edge ...">` に
 * 載せるので、ハッシュ済みのモジュールクラスをここで解決して渡す。
 * 非通電は既定色（`.canvas` 側）に任せるためクラスを付けない。
 */
const WIRE_CLASS: Record<WireState, string | undefined> = {
  inactive: undefined,
  plus: styles.wirePlus,
  zero: styles.wireZero,
  energized: styles.wireEnergized,
  short: styles.wireShort,
};

export function CircuitCanvas() {
  const { screenToFlowPosition } = useReactFlow();

  const document = useCircuitStore((state) => state.document);
  const selectedComponentIds = useCircuitStore(
    (state) => state.selectedComponentIds,
  );
  const selectedConnectionIds = useCircuitStore(
    (state) => state.selectedConnectionIds,
  );

  const addComponent = useCircuitStore((state) => state.addComponent);
  const moveComponent = useCircuitStore((state) => state.moveComponent);
  const removeComponents = useCircuitStore((state) => state.removeComponents);
  const addConnection = useCircuitStore((state) => state.addConnection);
  const removeConnections = useCircuitStore((state) => state.removeConnections);
  const setComponentSelected = useCircuitStore(
    (state) => state.setComponentSelected,
  );
  const setConnectionSelected = useCircuitStore(
    (state) => state.setConnectionSelected,
  );
  const setViewport = useCircuitStore((state) => state.setViewport);

  const result = useSimulationStore((state) => state.result);
  const pressedSwitches = useSimulationStore((state) => state.pressedSwitches);

  // 停止中は result が null で、ビューは空＝すべて非通電として描かれる
  const view = useMemo(
    () =>
      buildSimulationView(document, componentRegistry, result, pressedSwitches),
    [document, result, pressedSwitches],
  );

  const nodes = useMemo(
    () => toDeviceNodes(document, componentRegistry, selectedComponentIds, view),
    [document, selectedComponentIds, view],
  );
  const edges = useMemo(
    () =>
      toWireEdges(document, selectedConnectionIds).map((edge) => {
        const state = view.wireOf.get(edge.id) ?? "inactive";
        return { ...edge, className: WIRE_CLASS[state] };
      }),
    [document, selectedConnectionIds, view],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<DeviceNodeType>[]) => {
      for (const change of changes) {
        switch (change.type) {
          case "position":
            // ドラッグ中は毎フレーム来る。Step 6 の Undo 履歴に積むのは
            // ここではなく onNodeDragStop（design.md §7）
            if (change.position) moveComponent(change.id, change.position);
            break;
          case "remove":
            removeComponents([change.id]);
            break;
          case "select":
            setComponentSelected(change.id, change.selected);
            break;
          default:
            // dimensions / add / replace はドキュメントに影響しない
            break;
        }
      }
    },
    [moveComponent, removeComponents, setComponentSelected],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      for (const change of changes) {
        switch (change.type) {
          case "remove":
            removeConnections([change.id]);
            break;
          case "select":
            setConnectionSelected(change.id, change.selected);
            break;
          default:
            break;
        }
      }
    },
    [removeConnections, setConnectionSelected],
  );

  const onConnect = useCallback(
    (connection: Connection) => addConnection(connection),
    [addConnection],
  );

  const isValidConnection = useCallback(
    (params: Connection | Edge) => canConnectTerminals(document, params),
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
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onMoveEnd={onMoveEnd}
        defaultViewport={document.viewport}
        // 端子に「入力 / 出力」の区別は無い。Loose にすることで
        // どの端子からどの端子へでもドラッグできる（design.md §8.1）
        connectionMode={ConnectionMode.Loose}
        connectionLineType={ConnectionLineType.SmoothStep}
        deleteKeyCode={DELETE_KEYS}
        // 左ドラッグはパン、Shift+ドラッグで範囲選択、Ctrl/Cmd+クリックで複数選択。
        // 左ドラッグを範囲選択にすると、配線しようとして掴み損ねるたびに
        // 選択枠が出てパンできなくなる
        multiSelectionKeyCode={["Control", "Meta"]}
        panOnScroll
        minZoom={0.2}
        maxZoom={2.5}
        nodeOrigin={[0, 0]}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        <Controls showInteractive={false} />
        {document.components.length === 0 && (
          <Panel position="top-center">
            <p className={styles.emptyHint}>
              左のパレットから部品をドラッグして配置し、端子（小さな丸）どうしをドラッグして配線します。
            </p>
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}
