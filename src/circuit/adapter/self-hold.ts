/**
 * 自己保持の検出（design.md §5.9）。
 *
 * §5.6 の配線色は「今この線に電源が届いているか」までしか言わない。だが
 * 自己保持回路を読むときに知りたいのは **「今このリレーを保持しているのは誰か」**
 * ―― 押しているボタンなのか、自分の接点なのか ―― であり、それは電位からは
 * 読み取れない。ボタンを押している間も離した後も、コイルの + 側は同じ緑になる。
 *
 * ここでは 2 つのことを別々に求める。
 *
 * 1. **どのリレーが自己保持しているか** ―― 励磁中のリレー 1 個ずつに
 *    「もしこのリレーが落ちたら、そのまま落ちたままか」を問う（`simulate()` の再実行）
 * 2. **どの線が保持しているか** ―― 保持ループそのものを求める。すなわち
 *    **切ればそのリレーが落ちる線**（電源 → コイル → 自分の接点 → 電源の一周）
 *
 * 2 が「コイル側の枝」ではなく一周なのは、凡例が「ここを切ると落ちます」と
 * 約束しているため。枝だけを塗ると、**切っても落ちない線（開いた起動ボタンへ
 * ぶら下がる行き止まり）が紫になり、切れば落ちる帰り道（自己保持接点 →
 * 停止ボタン → 0V）が緑のまま**という、約束と逆の絵になる。
 *
 * **型番分岐は書かない**（CLAUDE.md 設計原則 2）。見るのは
 * `ComponentDefinition` のコイル端子と、エンジンが返す導通ペアだけで、
 * 接点が何組あるか・どの端子が自己保持に使われているかは問わない。
 *
 * このファイルは React を import しない純粋関数なので node 環境の Vitest で検証できる。
 */

import { conductingPairs, simulate } from "@/circuit/engine";
import type {
  CircuitDocument,
  ComponentDefinitionRegistry,
  SimulationResult,
} from "@/circuit/types";
import { terminalKey, terminalRefKey } from "@/circuit/types";

export type SelfHoldView = {
  /** 自分の接点で自分のコイルを保持しているリレーの componentId */
  relays: ReadonlySet<string>;
  /** 保持ループに載る端子（`terminalKey()`） */
  terminals: ReadonlySet<string>;
  /**
   * 保持ループに載る配線（`CircuitConnection.id`）。
   *
   * 端子の集合から引き直せない ―― 同じ端子から出ていても、保持ループの線と
   * 行き止まりの線が混在するため（配線の色を端子から引くと後者まで紫になる）。
   */
  connections: ReadonlySet<string>;
};

/** 自己保持が 1 つも無いときのビュー。停止中もこれを使う */
export const EMPTY_SELF_HOLD: SelfHoldView = {
  relays: new Set(),
  terminals: new Set(),
  connections: new Set(),
};

/**
 * 電源の +24V / 0V を 1 点に束ねる仮想ノード。
 *
 * 端子キー（`"部品ID:端子ID"`）と衝突しない名前にしてある。電源が複数あっても
 * 「+ 側のどれかに届くか」を 1 回の探索で扱えるようにするためのもので、
 * このノード自身は端子ではないので色を持たない。
 */
const PLUS_NODE = "@plus";
const ZERO_NODE = "@zero";

/** 経路グラフの 1 本。`connectionId` を持つものだけが画面上の「配線」 */
type PathEdge = {
  a: string;
  b: string;
  /** 電線なら `CircuitConnection.id`。部品内部の導通と仮想枝は持たない */
  connectionId?: string;
};

type PathGraph = {
  edges: PathEdge[];
  /** ノード → そのノードに接続する辺の index */
  adjacency: Map<string, number[]>;
};

/**
 * 「今この瞬間、電流が通れる道」のグラフを組む。
 *
 * ネット（`SimulationResult.netOf`）は連結成分までしか持たず、**どの端子どうしが
 * 直接つながっているかを失っている**ので、保持ループはネットからは求まらない。
 * 辺の作り方は `buildNets()` と同じ ―― 電線と、閉じている接点・スイッチ・端子台
 * だけを結び、負荷（コイル・ランプ・ダイオード）は結ばない（design.md §5.2）。
 */
const buildPathGraph = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
  pressedSwitches: ReadonlySet<string>,
  energizedRelays: ReadonlySet<string>,
): PathGraph => {
  const edges: PathEdge[] = [];
  const adjacency = new Map<string, number[]>();

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

  return { edges, adjacency };
};

/**
 * 橋（切ると連結成分が割れる辺）を全部求める ―― Tarjan の低リンク法。
 *
 * **再帰ではなく明示スタックで書く。** 端子数は高々数百だが、経路探索の深さが
 * 回路の規模に比例するため、スタック深さを言語側の上限に預けない。
 *
 * 多重辺（同じ 2 端子を 2 本の電線で結んだ回路）は「来た辺の index」だけを
 * 除外することで正しく扱える ―― どちらか 1 本を切っても導通が残るので、
 * 2 本とも橋にはならない。
 */
const findBridges = (graph: PathGraph): Set<number> => {
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
const twoEdgeComponents = (
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
 * `from` から `to` へ行くのに必ず通る橋を、通る順に返す。
 *
 * 2 辺連結成分を 1 ノードに潰すと、橋だけを辺に持つ**木**になる。木の上の道は
 * 一意なので、その道に載る橋がそのまま「切れば `from` と `to` が切り離される辺」。
 * 別ルートがある辺（＝橋でない辺）は初めから木に含まれないので、
 * 「切っても落ちない線」が混ざることはない。
 */
const bridgesOnPath = (
  graph: PathGraph,
  bridges: ReadonlySet<number>,
  componentOf: ReadonlyMap<string, number>,
  from: string,
  to: string,
): number[] => {
  const start = componentOf.get(from);
  const goal = componentOf.get(to);
  if (start === undefined || goal === undefined) return [];
  if (start === goal) return [];

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

  const path: number[] = [];
  let cursor = goal;
  while (cursor !== start) {
    const step = cameFrom.get(cursor);
    if (!step) return [];
    path.push(step.edge);
    cursor = step.component;
  }
  return path.reverse();
};

/**
 * 自己保持しているリレーと、その保持ループを求める。
 *
 * @param result 現在の（安定した）シミュレーション結果。停止中は `null`
 * @param pressedSwitches 現在操作中のスイッチ。**what-if でも同じものを渡す**
 *   —— ボタンを押したままなら「押している限り保持されている」が正しい答え
 */
export const buildSelfHold = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
  result: SimulationResult | null,
  pressedSwitches: ReadonlySet<string>,
): SelfHoldView => {
  if (!result || result.energizedRelays.size === 0) return EMPTY_SELF_HOLD;

  const relays = new Set<string>();
  const terminals = new Set<string>();
  const connections = new Set<string>();

  const graph = buildPathGraph(
    document,
    definitions,
    pressedSwitches,
    result.energizedRelays,
  );
  const bridges = findBridges(graph);
  const componentOf = twoEdgeComponents(graph, bridges);

  for (const instance of document.components) {
    const definition = definitions.get(instance.definitionId);
    if (!definition) continue;
    const { electrical } = definition;
    if (electrical.kind !== "relay") continue;
    if (!result.energizedRelays.has(instance.id)) continue;

    // このリレーだけを落とした状態から解き直す。接点も一緒に開く
    const dropped = new Set(result.energizedRelays);
    dropped.delete(instance.id);
    const whatIf = simulate(document, definitions, {
      pressedSwitches,
      previousEnergizedRelays: dropped,
    });

    // 戻ってきた＝外部（ボタン・他のリレーの接点）が保持している。
    // 自分の接点を開いても消えないので、自己保持とは呼ばない
    if (whatIf.energizedRelays.has(instance.id)) continue;

    relays.add(instance.id);

    /*
     * 保持ループ＝「コイルの + 側 → 電源の + へ」と「コイルの − 側 → 0V へ」の
     * 2 本の道に載る橋。コイルは union されていない（§5.2）ので、この 2 本を
     * 別々に辿って初めて一周になる。
     *
     * どちらの端子が + 側に立っているかは実際のネット状態から読む。極性なしの
     * コイル（MY2N / MY4N）は逆接でも励磁するので、定義上の
     * `positiveTerminal` が 0V 側にいることがある（design.md §5.3）。
     */
    const coilPlus = terminalKey(
      instance.id,
      electrical.relay.coil.positiveTerminal,
    );
    const coilMinus = terminalKey(
      instance.id,
      electrical.relay.coil.negativeTerminal,
    );
    const plusState = result.netState.get(result.netOf.get(coilPlus) ?? -1);
    const reversed = plusState?.reachesPlus !== true;

    for (const [terminal, supply] of [
      [coilPlus, reversed ? ZERO_NODE : PLUS_NODE],
      [coilMinus, reversed ? PLUS_NODE : ZERO_NODE],
    ] as const) {
      for (const edgeIndex of bridgesOnPath(
        graph,
        bridges,
        componentOf,
        terminal,
        supply,
      )) {
        const edge = graph.edges[edgeIndex];
        if (edge.connectionId) connections.add(edge.connectionId);
        for (const node of [edge.a, edge.b]) {
          if (node !== PLUS_NODE && node !== ZERO_NODE) terminals.add(node);
        }
      }
    }
  }

  return { relays, terminals, connections };
};
