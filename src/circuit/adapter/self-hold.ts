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
 * **経路グラフと橋の計算そのものは `path-graph.ts` が持つ。** 同じ 1 枚の
 * グラフを電流の向き（§5.10）・負荷経路の説明（§5.11）と共有しており、
 * ここで組み直すと §5.2 の「負荷は結ばない」規則が複数箇所に散る。
 *
 * **型番分岐は書かない**（CLAUDE.md 設計原則 2）。見るのは
 * `ComponentDefinition` のコイル端子と、エンジンが返す導通ペアだけで、
 * 接点が何組あるか・どの端子が自己保持に使われているかは問わない。
 *
 * このファイルは React を import しない純粋関数なので node 環境の Vitest で検証できる。
 */

import { reachesPlus, simulate } from "@/circuit/engine";
import type {
  CircuitDocument,
  ComponentDefinitionRegistry,
  SimulationResult,
} from "@/circuit/types";
import { terminalKey } from "@/circuit/types";

import {
  PLUS_NODE,
  ZERO_NODE,
  bridgesOnPath,
  isSupplyNode,
  solvePathGraph,
} from "./path-graph";

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

  const { graph, bridges, componentOf } = solvePathGraph(
    document,
    definitions,
    pressedSwitches,
    result.energizedRelays,
  );

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
    const reversed = !reachesPlus(plusState);

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
          if (!isSupplyNode(node)) terminals.add(node);
        }
      }
    }
  }

  return { relays, terminals, connections };
};
