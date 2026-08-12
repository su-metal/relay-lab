/**
 * React Flow の Node / Edge と `CircuitDocument` の相互変換（CLAUDE.md 設計原則 4）。
 *
 * **表示用の Edge と電気的接続を同一視しない。** 電気的な真実は常に
 * `CircuitConnection`（端子 → 端子）側にあり、React Flow の Node / Edge は
 * そこから毎回組み立てる派生データにすぎない。React Flow を別のライブラリに
 * 差し替えても、書き換えるのはこのファイルと UI 層だけで済む。
 *
 * このファイルは `@xyflow/react` を **型としてのみ** import する。
 * 実行時依存を持たないので Vitest の node 環境でそのまま検証できる。
 */

import type { Connection, Edge, Node } from "@xyflow/react";

import type {
  CircuitConnection,
  CircuitDocument,
  ComponentDefinition,
  ComponentDefinitionRegistry,
  TerminalDefinition,
  TerminalSide,
} from "@/circuit/types";
import { terminalRefKey } from "@/circuit/types";

import {
  EMPTY_CURRENT_FLOW,
  type CurrentFlowView,
  type FlowDirection,
} from "./current-flow";
import {
  IDLE_SIMULATION_VIEW,
  terminalStatesOf,
  type DeviceSimulationState,
  type SimulationView,
  type WireState,
} from "./simulation-view";
import type { ConnectedTerminalInfo } from "./terminal-connections";

/** 全部品が使う唯一のノード種別。型番ごとのノードは作らない（design.md §2） */
export const DEVICE_NODE_TYPE = "device";

/**
 * 配線の Edge 種別（`components/edges/WireEdge.tsx`）。
 *
 * 標準の `"smoothstep"` ではなく自前の Edge を使う。折れる位置をずらして
 * 配線の重なりを解くため（レーン分離・design.md §8.7）。見た目は smoothstep と
 * 同じ直交配線で、経路の計算も React Flow の `getSmoothStepPath` に任せている。
 */
export const WIRE_EDGE_TYPE = "wire";

/**
 * `DeviceNode` が描画に使うデータ。
 *
 * 定義そのものを載せているのは、ノード側で ID からレジストリを引き直さずに
 * 済ませるため。定義はアプリ起動中は不変なので参照を共有して問題ない。
 */
export type DeviceNodeData = {
  definition: ComponentDefinition;
  /**
   * 実際に描く端子。**`definition.terminals` ではなくこちらを描くこと。**
   * 左右反転している部品では位置と辺が鏡像になっている（`layoutTerminals`）。
   */
  terminals: readonly TerminalDefinition[];
  /** 左右反転して描くか。図記号（SVG）の向きを合わせるために UI へ渡す */
  flipped: boolean;
  /** インスタンスのラベル（"RY1"）。未設定なら型番を出す */
  label?: string;
  /**
   * タイマーの設定時間（ms）。**停止中でもノードに出す**ので、
   * シミュレーション状態（`simulation`）とは別に渡す（design.md §5.13）。
   * タイマー以外は持たない
   */
  presetMs?: number;
  /**
   * シミュレーション中の部品の状態。**停止中は `undefined`。**
   * 「消磁している」と「そもそも動いていない」を描き分けるための区別。
   */
  simulation?: DeviceSimulationState;
  /** `TerminalDefinition.id` → 端子の電位状態。停止中は `undefined` */
  terminalStates?: ReadonlyMap<string, WireState>;
  /**
   * `TerminalDefinition.id` → その端子につながる配線の相手側一覧。
   * 端子ツールチップの「接続先」に出す（design.md §8.3）。配線が無い端子は
   * キー自体が存在しない（空配列と未接続を区別する必要が無いため）。
   */
  terminalConnections?: ReadonlyMap<string, readonly ConnectedTerminalInfo[]>;
};

export type DeviceNode = Node<DeviceNodeData, typeof DEVICE_NODE_TYPE>;

/**
 * React Flow の Handle ID は `TerminalDefinition.id` をそのまま使う。
 *
 * 端子 ID は部品定義内で一意、Handle ID はノード内で一意であればよいので、
 * 変換を挟まずに一致させられる。ここを加工すると Edge から端子を復元する
 * 経路が増えて壊れやすくなるため、**意図的に恒等写像にしている。**
 */
export const handleIdOf = (terminalId: string): string => terminalId;

/** 左右反転で入れ替わる辺。上下は反転しても向きが変わらない */
const MIRRORED_SIDE: Record<TerminalSide, TerminalSide> = {
  left: "right",
  right: "left",
  top: "top",
  bottom: "bottom",
};

/**
 * 端子 1 個を左右反転した位置へ写す。
 *
 * 相対座標なので x を `1 - x` にするだけで、部品の寸法には依存しない。
 * 辺（`side`）も一緒に返さないと、React Flow の Handle と配線の出る向きが
 * 元のままになり、反転した部品から線が本体を横切って出ていく。
 *
 * **ID・ラベル・番号・役割は一切変えない。** 反転は見た目だけの操作であり、
 * ここで端子の同一性に触れると `CircuitConnection` が指す先が壊れる。
 */
export const mirrorTerminal = (
  terminal: TerminalDefinition,
): TerminalDefinition => ({
  ...terminal,
  position: { x: 1 - terminal.position.x, y: terminal.position.y },
  side: MIRRORED_SIDE[terminal.side],
});

/**
 * 部品 1 個ぶんの端子配置。
 *
 * 反転していなければ **定義の配列をそのまま返す**（新しい配列を作らない）。
 * ノードはドキュメントが変わるたびに組み直されるので、反転していない部品まで
 * 端子 14 個を毎回コピーする理由が無い。
 */
export const layoutTerminals = (
  definition: ComponentDefinition,
  flipped: boolean,
): readonly TerminalDefinition[] =>
  flipped ? definition.terminals.map(mirrorTerminal) : definition.terminals;

/**
 * `buildTerminalConnections()` の全体表を 1 部品ぶんに絞る
 * （`TerminalDefinition.id` → 接続先一覧）。
 *
 * ノードは自分の端子しか描かないので、全体表をそのまま渡さずに絞る
 * （`terminalStatesOf` と同じ理由）。
 */
const connectionsForComponent = (
  table: ReadonlyMap<string, readonly ConnectedTerminalInfo[]>,
  componentId: string,
  terminalIds: readonly string[],
): ReadonlyMap<string, readonly ConnectedTerminalInfo[]> | undefined => {
  if (table.size === 0) return undefined;
  const result = new Map<string, readonly ConnectedTerminalInfo[]>();
  for (const terminalId of terminalIds) {
    const info = table.get(terminalRefKey({ componentId, terminalId }));
    if (info) result.set(terminalId, info);
  }
  return result;
};

/**
 * 1 インスタンスを React Flow のノードにする。
 *
 * **`measured` を必ず載せること。** ノードは毎回ドキュメントから組み直す派生
 * データなので、React Flow から見ると「別オブジェクトの新しいノード」に見える。
 * `measured` が無いノードを渡すと React Flow は初期化前とみなして
 * 端子の実測値（handleBounds）を捨て、ノードを `visibility: hidden` に戻す。
 * こうなると **配線が消え、以後つなげなくなる。**
 *
 * 幸い部品の寸法は `visual` で確定しているので、実測を待たずにそのまま渡せる。
 */
export const toDeviceNode = (
  instance: CircuitDocument["components"][number],
  definition: ComponentDefinition,
  selected = false,
  view: SimulationView = IDLE_SIMULATION_VIEW,
  terminalConnections: ReadonlyMap<
    string,
    readonly ConnectedTerminalInfo[]
  > = new Map(),
): DeviceNode => ({
  id: instance.id,
  type: DEVICE_NODE_TYPE,
  position: instance.position,
  data: {
    definition,
    terminals: layoutTerminals(definition, instance.flipped === true),
    flipped: instance.flipped === true,
    label: instance.label,
    presetMs: instance.presetMs,
    simulation: view.deviceOf.get(instance.id),
    terminalStates: terminalStatesOf(
      view,
      instance.id,
      definition.terminals.map((terminal) => terminal.id),
    ),
    terminalConnections: connectionsForComponent(
      terminalConnections,
      instance.id,
      definition.terminals.map((terminal) => terminal.id),
    ),
  },
  selected,
  measured: {
    width: definition.visual.width,
    height: definition.visual.height,
  },
  // 部品本体ではなく端子だけを接続点にする（要件 US-B）。
  // Handle を持たない本体は connectable でも接続先にならないが、明示しておく。
  connectable: true,
});

/**
 * ドキュメント全体をノード配列へ。
 *
 * 定義が見つからない部品は **描画対象から落とす。** 例外にしないのは、
 * 将来 LocalStorage から読んだ古い定義 ID 1 個で画面全体が落ちるのを避けるため。
 * 読み込み時の検証は Step 6 のローダー側の責務。
 */
export const toDeviceNodes = (
  document: CircuitDocument,
  registry: ComponentDefinitionRegistry,
  selectedComponentIds: readonly string[] = [],
  view: SimulationView = IDLE_SIMULATION_VIEW,
  terminalConnections: ReadonlyMap<
    string,
    readonly ConnectedTerminalInfo[]
  > = new Map(),
): DeviceNode[] => {
  const selected = new Set(selectedComponentIds);
  const nodes: DeviceNode[] = [];
  for (const instance of document.components) {
    const definition = registry.get(instance.definitionId);
    if (!definition) continue;
    nodes.push(
      toDeviceNode(
        instance,
        definition,
        selected.has(instance.id),
        view,
        terminalConnections,
      ),
    );
  }
  return nodes;
};

/**
 * `WireEdge` が描画に使うデータ。
 *
 * 電気的な意味は持たない **表示だけの値**。`CircuitConnection` には入れず、
 * ノードの `terminals` と同じく毎回組み立てる（design.md §8.7）。
 */
export type WireEdgeData = {
  /**
   * 幹線（中間の直線区間）をずらす量。キャンバス座標の px で、符号は
   * 縦の幹線なら右が正、横の幹線なら下が正。0 なら既定の経路。
   */
  lane?: number;
  /**
   * 電流の向き（design.md §5.10）。`from` → `to` に流れていれば `"forward"`。
   *
   * **向きが決まらない線は持たない。** 並列に分かれた区間は実際に分流するので
   * 1 本に決まらず、`current-flow.ts` がそもそも返さない。
   */
  flow?: FlowDirection;
  /**
   * 向きを**線そのもの**で表す線か（design.md §5.10）。
   *
   * 自己保持の紫（§5.9）は線自身が流れる破線なので、そこへ切れ目の
   * オーバーレイを重ねると**周期の違う破線が 2 つ重なって模様が壊れる。**
   * この線では向きを `animation-direction` で線に与え、オーバーレイは出さない。
   */
  flowOnStroke?: boolean;
};

export type WireEdge = Edge<WireEdgeData, typeof WIRE_EDGE_TYPE>;

/** 1 接続を React Flow の Edge にする */
export const toWireEdge = (
  connection: CircuitConnection,
  selected = false,
  lane = 0,
  flow?: FlowDirection,
): WireEdge => ({
  id: connection.id,
  type: WIRE_EDGE_TYPE,
  source: connection.from.componentId,
  sourceHandle: handleIdOf(connection.from.terminalId),
  target: connection.to.componentId,
  targetHandle: handleIdOf(connection.to.terminalId),
  selected,
  data: { lane, flow },
});

export const toWireEdges = (
  document: CircuitDocument,
  selectedConnectionIds: readonly string[] = [],
  lanes: ReadonlyMap<string, number> = new Map(),
  flow: CurrentFlowView = EMPTY_CURRENT_FLOW,
): WireEdge[] => {
  const selected = new Set(selectedConnectionIds);
  return document.connections.map((connection) =>
    toWireEdge(
      connection,
      selected.has(connection.id),
      lanes.get(connection.id) ?? 0,
      flow.directionOf.get(connection.id),
    ),
  );
};

/**
 * React Flow の接続イベントから `CircuitConnection` を作る。
 *
 * Handle ID が欠けている接続は `null` を返す。**これが「接続は必ず端子 → 端子」
 * という要件（US-B）を型の外側で担保している唯一の場所。** 部品本体へ落ちた
 * ドラッグはここで捨てられ、ドキュメントには入らない。
 */
export const connectionFromReactFlow = (
  params: Connection | Edge,
  id: string,
): CircuitConnection | null => {
  const { source, target, sourceHandle, targetHandle } = params;
  if (!source || !target || !sourceHandle || !targetHandle) return null;
  // 同一端子どうしの自己接続は電気的に意味がない
  if (source === target && sourceHandle === targetHandle) return null;
  return {
    id,
    from: { componentId: source, terminalId: sourceHandle },
    to: { componentId: target, terminalId: targetHandle },
  };
};

const refKey = (componentId: string, terminalId: string) =>
  `${componentId} ${terminalId}`;

/**
 * 2 つの接続が同じ端子ペアか。**配線に向きはない**ので順序を無視して比べる。
 * A→B と B→A は同じ 1 本であり、2 本張れてはいけない。
 */
export const isSameTerminalPair = (
  a: CircuitConnection,
  b: CircuitConnection,
): boolean => {
  const aKeys = [
    refKey(a.from.componentId, a.from.terminalId),
    refKey(a.to.componentId, a.to.terminalId),
  ].sort();
  const bKeys = [
    refKey(b.from.componentId, b.from.terminalId),
    refKey(b.to.componentId, b.to.terminalId),
  ].sort();
  return aKeys[0] === bKeys[0] && aKeys[1] === bKeys[1];
};

/**
 * 同じ端子ペアの配線がすでに存在するか。
 *
 * **自分自身は重複とみなさない**（`id` が一致する既存は飛ばす）。つなぎ替え
 * （§8.8）では引き直している最中の配線がドキュメントに残ったままなので、
 * 素直に比べると「元の端子へ戻す」「片端だけ動かす」がどちらも自分との重複に
 * なって弾かれる。新規配線の候補 ID は既存とぶつからないため影響を受けない。
 */
export const hasTerminalPair = (
  document: CircuitDocument,
  connection: CircuitConnection,
): boolean =>
  document.connections.some(
    (existing) =>
      existing.id !== connection.id && isSameTerminalPair(existing, connection),
  );

/**
 * まだドキュメントに無い配線を表す仮 ID。既存の配線 ID（`wire-...`）とは
 * 決してぶつからない綴りにしてある（上の「自分自身は除く」を骨抜きにしないため）。
 */
const CANDIDATE_CONNECTION_ID = "__candidate__";

/**
 * 配線ドラッグ中に接続先として許可してよいか（React Flow の `isValidConnection`）。
 * 端子以外・自己接続・重複配線を弾く。
 *
 * `reconnectingConnectionId` は**つなぎ替え中の配線 ID**（§8.8）。既存の配線の端を
 * 掴んで引き直している間は、その配線自身を重複判定から外さないと、どこへ落としても
 * 不許可になる。新規配線のときは省略する。
 */
export const canConnectTerminals = (
  document: CircuitDocument,
  params: Connection | Edge,
  reconnectingConnectionId?: string,
): boolean => {
  const candidate = connectionFromReactFlow(
    params,
    reconnectingConnectionId ?? CANDIDATE_CONNECTION_ID,
  );
  if (!candidate) return false;
  return !hasTerminalPair(document, candidate);
};
