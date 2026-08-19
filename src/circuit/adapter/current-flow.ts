/**
 * 電流の向き（design.md §5.10）。
 *
 * §5.6 の緑は「この線に電流が流れている」までしか言わない。だが回路を初めて
 * 読む人が知りたいのは **どちらからどちらへ流れているか** であり、
 * それは色からは読み取れない。
 *
 * **ネットからは絶対に求まらない。** ネットは等電位の連結成分であって
 * 向きを持たない。向きが決まるのは「電源の + からこの線を通って負荷へ、
 * 負荷から 0V へ」という**経路**の上だけなので、`path-graph.ts` の
 * 経路グラフを使う。
 *
 * ## 何に向きを付けるか
 *
 * 基本は **必ず通る線（橋）。** 加えて、入口と出口の間に並列に並んだ枝の束は、
 * 枝の中の向きが入口 → 出口で確定するので向きを付ける（`orientedEdgesOnPath`）。
 * **分流するから決まらない、のは「どちらの枝を通るか」であって
 * 「枝の中でどちら向きか」ではない。**
 *
 * 束と見なせない形 —— 途中で枝分かれする・区間の内側から外へ橋が出ている
 * （ホイートストンブリッジのような形）—— は今までどおり向きを出さない。
 * §5.9 の紫が橋だけを塗っているのと同じ判断で、
 * **塗り漏れ（向きが出ない線）はあっても、誤った向きは出ない。**
 *
 * このファイルは React を import しない純粋関数なので node 環境の Vitest で検証できる。
 */

import { coilEnergized, polarityAcross } from "@/circuit/engine";
import type {
  CircuitDocument,
  ComponentDefinitionRegistry,
  NetState,
  SimulationResult,
} from "@/circuit/types";
import { terminalKey, terminalRefKey } from "@/circuit/types";

import {
  PLUS_NODE,
  ZERO_NODE,
  orientedEdgesOnPath,
  solvePathGraph,
} from "./path-graph";

/**
 * 配線 1 本を流れる向き。
 *
 * 基準は `CircuitConnection` の `from` → `to`。**配線に電気的な向きは無い**
 * （`isSameTerminalPair` を参照）ので、これは描画のための基準でしかなく、
 * 「ユーザーがどちら向きに引いたか」に意味を与えるものではない。
 */
export type FlowDirection = "forward" | "backward";

export type CurrentFlowView = {
  /** `CircuitConnection.id` → 電流の向き。向きが決まらない線は**持たない** */
  directionOf: ReadonlyMap<string, FlowDirection>;
};

export const EMPTY_CURRENT_FLOW: CurrentFlowView = {
  directionOf: new Map(),
};

/** 通電中の負荷 1 個。両端のうちどちらが + 側に立っているかまで決めたもの */
export type EnergizedLoad = {
  /** + 側（電流が入ってくる側）の端子キー */
  inlet: string;
  /** 0V 側（電流が出ていく側）の端子キー */
  outlet: string;
};

/**
 * 通電中の負荷の両端を、電流の入口 / 出口として並べ替える。
 *
 * **定義上の `positiveTerminal` を入口と決め打たない。** 極性なしのコイル
 * （MY2N / MY4N）は逆接でも励磁するので、13 番が + 側に立っていることがある
 * （design.md §5.3）。実際のネット状態から読む。
 *
 * 経路の説明（§5.11）も同じ向きで書くので公開している。ここが 2 箇所に
 * 分かれると、矢印は 13 → 14 なのに文章は 14 → 13、という食い違いが起きる。
 */
export const orientLoad = (
  result: SimulationResult,
  componentId: string,
  terminalA: string,
  terminalB: string,
): EnergizedLoad | null => {
  const keyA = terminalKey(componentId, terminalA);
  const keyB = terminalKey(componentId, terminalB);
  const stateOf = (key: string): NetState | undefined =>
    result.netState.get(result.netOf.get(key) ?? -1);

  /*
   * **片側だけを見て「+ 側だから入口」と決めない。** 電源が複数あると、
   * 片側が PS1 の + に、もう片側が PS2 の 0V に届いていることがある ——
   * 基準が繋がっていなければ電流は流れないので、入口も出口も無い。
   * 両端を突き合わせる `polarityAcross` に判定を寄せる（design.md §5.3）。
   */
  const polarity = polarityAcross(stateOf(keyA), stateOf(keyB));
  if (polarity === "forward") return { inlet: keyA, outlet: keyB };
  if (polarity === "reverse") return { inlet: keyB, outlet: keyA };
  // 通電しているのに電位差が読めない＝短絡か浮いている。向きは付けない
  return null;
};

/** 通電中の負荷（励磁コイル・点灯ランプ）を集める */
const energizedLoads = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
  result: SimulationResult,
): EnergizedLoad[] => {
  const loads: EnergizedLoad[] = [];

  for (const instance of document.components) {
    const definition = definitions.get(instance.definitionId);
    if (!definition) continue;
    const { electrical } = definition;

    /*
     * **`energizedRelays` ではなくコイルの状態で見る**（design.md §5.13）。
     * カウント中のタイマーはコイルに電流が流れているが接点はまだ動いていない
     * ので、接点の側で判定すると計測中の矢印がまるごと消える。
     */
    if (electrical.kind === "relay" && coilEnergized(result, instance.id, electrical)) {
      const { coil } = electrical.relay;
      // コイルの無い機器（カットリレー・操作卓）に電流の向きは描けない
      const load =
        coil &&
        orientLoad(
          result,
          instance.id,
          coil.positiveTerminal,
          coil.negativeTerminal,
        );
      if (load) loads.push(load);
    }

    if (electrical.kind === "lamp" && result.litLamps.has(instance.id)) {
      const load = orientLoad(
        result,
        instance.id,
        electrical.terminalA,
        electrical.terminalB,
      );
      if (load) loads.push(load);
    }
  }

  return loads;
};

/**
 * 配線 1 本ごとの電流の向きを求める。
 *
 * @param result シミュレーション結果。停止中（`null`）は空のビューを返す
 *   —— 動かしていない回路に電流は流れていない
 */
export const buildCurrentFlow = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
  result: SimulationResult | null,
  pressedSwitches: ReadonlySet<string>,
): CurrentFlowView => {
  if (!result) return EMPTY_CURRENT_FLOW;

  const loads = energizedLoads(document, definitions, result);
  if (loads.length === 0) return EMPTY_CURRENT_FLOW;

  const { graph, bridges, componentOf } = solvePathGraph(
    document,
    definitions,
    pressedSwitches,
    result.energizedRelays,
  );

  /** `CircuitConnection.id` → `from` 側の端子キー。向きの基準 */
  const fromKeyOf = new Map<string, string>();
  for (const connection of document.connections) {
    fromKeyOf.set(connection.id, terminalRefKey(connection.from));
  }

  const directionOf = new Map<string, FlowDirection>();
  /**
   * 逆向きが 2 度割り当てられた配線。
   *
   * 電源が 2 台あって同じ幹線を逆向きに使うような回路では、1 本の線に
   * 相反する向きが載りうる。**そのときは向きを消す。** どちらか一方を
   * 残すと、残った側が「正しい向き」として読まれてしまう。
   */
  const conflicted = new Set<string>();

  const assign = (connectionId: string, direction: FlowDirection): void => {
    if (conflicted.has(connectionId)) return;
    const existing = directionOf.get(connectionId);
    if (existing === undefined) {
      directionOf.set(connectionId, direction);
      return;
    }
    if (existing !== direction) {
      conflicted.add(connectionId);
      directionOf.delete(connectionId);
    }
  };

  for (const load of loads) {
    /*
     * 電流は「+ → 負荷の入口」と「負荷の出口 → 0V」の 2 本を流れる。
     * 負荷は union されていない（§5.2）ので、この 2 本を別々に辿って
     * 初めて一周になる —— §5.9 の保持ループとまったく同じ組み立て方。
     *
     * どちらも `orientedEdgesOnPath` の `from` を**電流の上流**に置く。
     * こうすると返ってくる `tail → head` がそのまま電流の向きになる。
     */
    const runs = [
      orientedEdgesOnPath(graph, bridges, componentOf, PLUS_NODE, load.inlet),
      orientedEdgesOnPath(graph, bridges, componentOf, load.outlet, ZERO_NODE),
    ];

    for (const run of runs) {
      for (const edge of run) {
        const { connectionId } = graph.edges[edge.index];
        // 部品内部の導通と仮想枝（`@plus` / `@zero`）は画面上の線ではない
        if (!connectionId) continue;
        const fromKey = fromKeyOf.get(connectionId);
        if (fromKey === undefined) continue;
        assign(connectionId, edge.tail === fromKey ? "forward" : "backward");
      }
    }
  }

  return { directionOf };
};
