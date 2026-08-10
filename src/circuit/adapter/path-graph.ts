/**
 * 「今この瞬間、電流が通れる道」のグラフ（design.md §5.9・§5.10・§5.11）。
 *
 * `SimulationResult` が持つネット（連結成分）は **どの端子どうしが直接
 * つながっているかを失っている。** 同じネットに居るというだけでは
 * 「保持している線」と「行き止まりの線」を区別できず、経路も辿れない。
 * そこでネットとは別に、端子を頂点・導通を辺とするグラフをここで組む。
 *
 * もともと `self-hold.ts` の中にあったものを切り出した。読み手のための
 * 切り分け（自己保持・電流の向き・励磁経路の説明）はどれも
 * **同じ 1 枚のグラフの上の別々の問い**であり、3 箇所で組み直すと
 * 「電線と閉じた接点だけを結ぶ」という §5.2 の規則が 3 つに増える。
 *
 * このファイルは React を import しない純粋関数なので node 環境の Vitest で検証できる。
 */

import { conductingPairs } from "@/circuit/engine";
import type {
  CircuitDocument,
  ComponentDefinitionRegistry,
  TerminalRef,
} from "@/circuit/types";
import { terminalKey, terminalRefKey } from "@/circuit/types";

/**
 * 電源の +24V / 0V を 1 点に束ねる仮想ノード。
 *
 * 端子キー（`"部品ID:端子ID"`）と衝突しない名前にしてある。電源が複数あっても
 * 「+ 側のどれかに届くか」を 1 回の探索で扱えるようにするためのもので、
 * このノード自身は端子ではないので色も表示も持たない。
 */
export const PLUS_NODE = "@plus";
export const ZERO_NODE = "@zero";

/** 仮想ノード（`@plus` / `@zero`）か。経路を端子だけに絞るときに使う */
export const isSupplyNode = (node: string): boolean =>
  node === PLUS_NODE || node === ZERO_NODE;

/** 経路グラフの 1 本。`connectionId` を持つものだけが画面上の「配線」 */
export type PathEdge = {
  a: string;
  b: string;
  /** 電線なら `CircuitConnection.id`。部品内部の導通と仮想枝は持たない */
  connectionId?: string;
};

export type PathGraph = {
  edges: PathEdge[];
  /** ノード → そのノードに接続する辺の index */
  adjacency: Map<string, number[]>;
  /**
   * 端子キー → どの部品のどの端子か。
   *
   * `terminalKey()` は `"部品ID:端子ID"` だが、**文字列を割って戻さない。**
   * 部品 ID に区切り文字が入っても壊れない経路を 1 本だけ残しておく。
   */
  terminalOf: Map<string, TerminalRef>;
};

/**
 * 経路グラフを組む。
 *
 * 辺の作り方は `buildNets()` と同じ —— 電線と、閉じている接点・スイッチ・
 * 端子台だけを結び、**負荷（コイル・ランプ・ダイオード）は結ばない**
 * （design.md §5.2）。接点の開閉規則を書き直さないよう、判定は
 * エンジンの `conductingPairs()` をそのまま呼ぶ。
 */
export const buildPathGraph = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
  pressedSwitches: ReadonlySet<string>,
  energizedRelays: ReadonlySet<string>,
): PathGraph => {
  const edges: PathEdge[] = [];
  const adjacency = new Map<string, number[]>();
  const terminalOf = new Map<string, TerminalRef>();

  const connect = (a: string, b: string, connectionId?: string): void => {
    const index = edges.length;
    edges.push({ a, b, connectionId });
    for (const node of [a, b]) {
      const incident = adjacency.get(node);
      if (incident) incident.push(index);
      else adjacency.set(node, [index]);
    }
  };

  for (const connection of document.connections) {
    connect(
      terminalRefKey(connection.from),
      terminalRefKey(connection.to),
      connection.id,
    );
  }

  for (const instance of document.components) {
    const definition = definitions.get(instance.definitionId);
    if (!definition) continue;
    const { electrical } = definition;

    for (const terminal of definition.terminals) {
      terminalOf.set(terminalKey(instance.id, terminal.id), {
        componentId: instance.id,
        terminalId: terminal.id,
      });
    }

    for (const [a, b] of conductingPairs(
      instance.id,
      electrical,
      { pressedSwitches },
      energizedRelays,
    )) {
      connect(terminalKey(instance.id, a), terminalKey(instance.id, b));
    }

    if (electrical.kind === "power") {
      connect(terminalKey(instance.id, electrical.positiveTerminal), PLUS_NODE);
      connect(terminalKey(instance.id, electrical.zeroTerminal), ZERO_NODE);
    }
  }

  return { edges, adjacency, terminalOf };
};

/**
 * ある頂点から辿り着けるノードを全部返す。
 *
 * 「+ 側に届いているか」はネットの 2 ビットでも読めるが、
 * **どこまで届いていて、どこで止まっているか**はグラフでしか読めない
 * （design.md §5.11 の「手前で開いている接点」）。
 */
export const reachableFrom = (
  graph: PathGraph,
  start: string,
): Set<string> => {
  const visited = new Set<string>([start]);
  const stack = [start];
  while (stack.length > 0) {
    const node = stack.pop() as string;
    for (const edgeIndex of graph.adjacency.get(node) ?? []) {
      const edge = graph.edges[edgeIndex];
      const next = edge.a === node ? edge.b : edge.a;
      if (visited.has(next)) continue;
      visited.add(next);
      stack.push(next);
    }
  }
  return visited;
};

/**
 * 橋（切ると連結成分が割れる辺）を全部求める —— Tarjan の低リンク法。
 *
 * **再帰ではなく明示スタックで書く。** 端子数は高々数百だが、経路探索の深さが
 * 回路の規模に比例するため、スタック深さを言語側の上限に預けない。
 *
 * 多重辺（同じ 2 端子を 2 本の電線で結んだ回路）は「来た辺の index」だけを
 * 除外することで正しく扱える —— どちらか 1 本を切っても導通が残るので、
 * 2 本とも橋にはならない。
 */
export const findBridges = (graph: PathGraph): Set<number> => {
  const discovered = new Map<string, number>();
  const low = new Map<string, number>();
  const bridges = new Set<number>();
  let timer = 0;

  type Frame = { node: string; parentEdge: number; cursor: number };

  for (const root of graph.adjacency.keys()) {
    if (discovered.has(root)) continue;
    discovered.set(root, timer);
    low.set(root, timer);
    timer += 1;

    const stack: Frame[] = [{ node: root, parentEdge: -1, cursor: 0 }];

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const incident = graph.adjacency.get(frame.node) ?? [];

      if (frame.cursor < incident.length) {
        const edgeIndex = incident[frame.cursor];
        frame.cursor += 1;
        if (edgeIndex === frame.parentEdge) continue;

        const edge = graph.edges[edgeIndex];
        const next = edge.a === frame.node ? edge.b : edge.a;
        const seen = discovered.get(next);

        if (seen === undefined) {
          discovered.set(next, timer);
          low.set(next, timer);
          timer += 1;
          stack.push({ node: next, parentEdge: edgeIndex, cursor: 0 });
        } else {
          low.set(frame.node, Math.min(low.get(frame.node) ?? 0, seen));
        }
        continue;
      }

      stack.pop();
      const parent = stack[stack.length - 1];
      if (!parent) continue;

      const childLow = low.get(frame.node) ?? 0;
      low.set(parent.node, Math.min(low.get(parent.node) ?? 0, childLow));
      // 子から親より上へ戻る道が 1 本も無い＝この辺が唯一の連絡路
      if (childLow > (discovered.get(parent.node) ?? 0)) {
        bridges.add(frame.parentEdge);
      }
    }
  }

  return bridges;
};

/** 橋を取り除いた連結成分（＝2 辺連結成分）に番号を振る */
export const twoEdgeComponents = (
  graph: PathGraph,
  bridges: ReadonlySet<number>,
): Map<string, number> => {
  const componentOf = new Map<string, number>();
  let nextId = 0;

  for (const root of graph.adjacency.keys()) {
    if (componentOf.has(root)) continue;
    const id = nextId;
    nextId += 1;
    const queue = [root];
    componentOf.set(root, id);

    while (queue.length > 0) {
      const node = queue.pop() as string;
      for (const edgeIndex of graph.adjacency.get(node) ?? []) {
        if (bridges.has(edgeIndex)) continue;
        const edge = graph.edges[edgeIndex];
        const next = edge.a === node ? edge.b : edge.a;
        if (componentOf.has(next)) continue;
        componentOf.set(next, id);
        queue.push(next);
      }
    }
  }

  return componentOf;
};

/**
 * 向き付きの橋。`tail` が出発点に近い側、`head` が目的地に近い側。
 *
 * **向きは電流の向きそのものではない。** 「`from` から `to` へ辿るときに
 * どちら向きに通るか」であり、電流の向きになるのは呼び出し側が
 * `from` に電源、`to` に負荷を置いたときだけ（design.md §5.10）。
 */
export type OrientedEdge = {
  /** `PathGraph.edges` の index */
  index: number;
  tail: string;
  head: string;
};

/**
 * 経路グラフの「橋だけの木」を組む。
 *
 * 2 辺連結成分を 1 ノードに潰すと、橋だけを辺に持つ**木**になる。
 * 木の上の道は一意なので、その道に載る橋がそのまま
 * 「切れば `from` と `to` が切り離される辺」。別ルートがある辺
 * （＝橋でない辺）は初めから木に含まれないので、
 * 「切っても落ちない線」が混ざることはない。
 */
const bridgeTree = (
  graph: PathGraph,
  bridges: ReadonlySet<number>,
  componentOf: ReadonlyMap<string, number>,
): Map<number, number[]> => {
  const treeEdges = new Map<number, number[]>();
  for (const edgeIndex of bridges) {
    const edge = graph.edges[edgeIndex];
    const a = componentOf.get(edge.a);
    const b = componentOf.get(edge.b);
    if (a === undefined || b === undefined) continue;
    for (const component of [a, b]) {
      const incident = treeEdges.get(component);
      if (incident) incident.push(edgeIndex);
      else treeEdges.set(component, [edgeIndex]);
    }
  }
  return treeEdges;
};

/**
 * `from` から `to` へ行くのに必ず通る橋を、**通る順・通る向き**で返す。
 *
 * 向きを返すのは、同じ道が「切れば落ちる線」（§5.9）と
 * 「電流がこちらへ流れる線」（§5.10）の両方に使われるため。
 * 前者に向きは要らないが、後者は向きが本体になる。
 */
export const orientedBridgesOnPath = (
  graph: PathGraph,
  bridges: ReadonlySet<number>,
  componentOf: ReadonlyMap<string, number>,
  from: string,
  to: string,
): OrientedEdge[] => {
  const start = componentOf.get(from);
  const goal = componentOf.get(to);
  if (start === undefined || goal === undefined) return [];
  if (start === goal) return [];

  const treeEdges = bridgeTree(graph, bridges, componentOf);

  // 木なので BFS で十分。来た橋を辿り直して道を復元する
  const cameFrom = new Map<number, { component: number; edge: number }>();
  const visited = new Set<number>([start]);
  const queue = [start];

  while (queue.length > 0) {
    const component = queue.shift() as number;
    if (component === goal) break;
    for (const edgeIndex of treeEdges.get(component) ?? []) {
      const edge = graph.edges[edgeIndex];
      const a = componentOf.get(edge.a) as number;
      const b = componentOf.get(edge.b) as number;
      const next = a === component ? b : a;
      if (visited.has(next)) continue;
      visited.add(next);
      cameFrom.set(next, { component, edge: edgeIndex });
      queue.push(next);
    }
  }

  if (!visited.has(goal)) return [];

  const path: OrientedEdge[] = [];
  let cursor = goal;
  while (cursor !== start) {
    const step = cameFrom.get(cursor);
    if (!step) return [];
    const edge = graph.edges[step.edge];
    // step.component が出発点に近い側。その側にある端点が tail
    const aIsTail = componentOf.get(edge.a) === step.component;
    path.push({
      index: step.edge,
      tail: aIsTail ? edge.a : edge.b,
      head: aIsTail ? edge.b : edge.a,
    });
    cursor = step.component;
  }
  return path.reverse();
};

/** 向きを使わない呼び出し向け（自己保持の塗り分け・§5.9） */
export const bridgesOnPath = (
  graph: PathGraph,
  bridges: ReadonlySet<number>,
  componentOf: ReadonlyMap<string, number>,
  from: string,
  to: string,
): number[] =>
  orientedBridgesOnPath(graph, bridges, componentOf, from, to).map(
    (edge) => edge.index,
  );

/**
 * 経路グラフと、その上の橋・2 辺連結成分を 1 度に用意する。
 *
 * 橋の計算は**リレー 1 個ごとではなく回路につき 1 回**。閉じている接点の集合は
 * 回路全体で 1 つなので、問いごとに変わるのは「どこからどこへの道を辿るか」だけ。
 */
export type SolvedPathGraph = {
  graph: PathGraph;
  bridges: ReadonlySet<number>;
  componentOf: ReadonlyMap<string, number>;
};

export const solvePathGraph = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
  pressedSwitches: ReadonlySet<string>,
  energizedRelays: ReadonlySet<string>,
): SolvedPathGraph => {
  const graph = buildPathGraph(
    document,
    definitions,
    pressedSwitches,
    energizedRelays,
  );
  const bridges = findBridges(graph);
  return { graph, bridges, componentOf: twoEdgeComponents(graph, bridges) };
};
