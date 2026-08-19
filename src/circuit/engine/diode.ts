/**
 * ダイオードの有向導通と向きの判定（design.md §5.4）。
 *
 * **ダイオードは今も union しない**（CLAUDE.md 設計原則 3・design.md §5.2）。
 * 一方通行を無向グラフの Union-Find で表せないという §5.4 の事情は変わっていない。
 * 代わりに、ネットを組み終えた後の電位をアノード → カソードの一方向にだけ流す。
 *
 * - `plusFrom`（+ 側に届いている電源）は アノード側ネット → カソード側ネット へ伝わる（順方向探索）
 * - `zeroFrom`（0V 側に届いている電源）は カソード側ネット → アノード側ネット へ伝わる（逆方向探索）
 *
 * これが §5.4 が予告していた「2 パス探索」で、ネットの分割そのものは変えないため
 * コイル（§5.3）とランプの判定規則は 1 行も変わらない。
 *
 * このファイルは型番を見ない（設計原則 2）。ダイオードを内蔵する MY4N-D2 は
 * ここではなく `CoilPolarity: "strict"` で表現され続ける。
 */

import type {
  CircuitDocument,
  ComponentDefinitionRegistry,
  NetState,
} from "@/circuit/types";
import { terminalKey } from "@/circuit/types";

import type { NetLookup } from "./graph";
import { reachesPlus, spansSupply } from "./potential";

/**
 * 伝搬中だけ使う可変版の `NetState`。
 * 読み出し側（`NetState`）は `ReadonlySet` なので、書き換えはここに閉じる。
 */
export type MutableNetState = {
  plusFrom: Set<string>;
  zeroFrom: Set<string>;
};

/** ネット間の有向辺。アノード側ネット → カソード側ネット */
export type DiodeEdge = {
  componentId: string;
  anodeNet: number;
  cathodeNet: number;
};

/** 回路中のダイオードを有向辺として取り出す */
export const collectDiodeEdges = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
  netOf: ReadonlyMap<string, number>,
): DiodeEdge[] => {
  const edges: DiodeEdge[] = [];

  for (const instance of document.components) {
    const definition = definitions.get(instance.definitionId);
    if (!definition) continue;
    const { electrical } = definition;
    if (electrical.kind !== "diode") continue;

    const anodeNet = netOf.get(
      terminalKey(instance.id, electrical.anodeTerminal),
    );
    const cathodeNet = netOf.get(
      terminalKey(instance.id, electrical.cathodeTerminal),
    );
    if (anodeNet === undefined || cathodeNet === undefined) continue;

    edges.push({ componentId: instance.id, anodeNet, cathodeNet });
  }

  return edges;
};

/**
 * ダイオードを通して電位を伝搬させる。`states` を直接書き換える。
 *
 * ダイオードの先にさらにダイオードがある配線に備えて、変化が無くなるまで回す。
 * 辺は回路 1 枚で高々数本なので素朴な反復で足りる。
 */
export const spreadThroughDiodes = (
  states: Map<number, MutableNetState>,
  edges: readonly DiodeEdge[],
): void => {
  if (edges.length === 0) return;

  /** `from` の要素を `into` へ足す。1 個でも増えたら true */
  const absorb = (into: Set<string>, from: ReadonlySet<string>): boolean => {
    let grew = false;
    for (const id of from) {
      if (into.has(id)) continue;
      into.add(id);
      grew = true;
    }
    return grew;
  };

  for (let changed = true; changed; ) {
    changed = false;
    for (const edge of edges) {
      const anode = states.get(edge.anodeNet);
      const cathode = states.get(edge.cathodeNet);
      if (!anode || !cathode) continue;

      // 順方向：+ 側の電位はアノードからカソードへ抜ける。
      // **どの電源から来たのかも一緒に運ぶ** —— ここで潰すと、ダイオードの
      // 先で「別の電源の 0V」と組み合わさって通電と誤判定される
      if (absorb(cathode.plusFrom, anode.plusFrom)) changed = true;
      // 逆方向探索：0V へ「戻れる」のもカソード側からアノード側だけ
      if (absorb(anode.zeroFrom, cathode.zeroFrom)) changed = true;
    }
  }
};

/** ダイオードにかかっているバイアスの向き */
export type DiodeBias =
  /** アノード側が + 電位。カソード側へ電位を通している */
  | "forward"
  /** カソード側が + 電位。電流を遮断している（逆起電力吸収ダイオードの通常状態） */
  | "reverse"
  /** どちらの側にも電源が届いていない */
  | "none";

/**
 * コイルと並列に入ったダイオードの向き。
 *
 * リレーコイルは誘導負荷で、消磁の瞬間に電源電圧の数十倍の逆起電力を出す。
 * これを吸収するのがコイルと**並列**に入れる還流ダイオードで、向きは
 * 「カソードをコイルの + 側へ」。逆に挿すと通電中ずっと順方向になり、
 * コイルと並列の短絡経路になってダイオードが焼損する。
 */
export type FlybackOrientation =
  /** カソードがコイルの + 側。正しい向き（通常は逆バイアスで何もしない） */
  | "protective"
  /** アノードがコイルの + 側。順方向の短絡経路になる */
  | "reversed";

export type DiodeInspection = {
  componentId: string;
  bias: DiodeBias;
  /**
   * 負荷を挟まずに + と 0V をまたいでいる。**同じ 1 台の電源**の + が
   * アノード側に、0V がカソード側に届いている状態で、
   * 実機ではダイオードに電流が集中して焼損する。
   */
  shorting: boolean;
  /** コイルと並列に入っている場合の相手リレーと向き */
  flyback?: { relayId: string; orientation: FlybackOrientation };
};

/** `${+ 側ネット}|${− 側ネット}` → リレーのインスタンス ID */
const coilNetIndex = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
  netOf: ReadonlyMap<string, number>,
): Map<string, string> => {
  const index = new Map<string, string>();

  for (const instance of document.components) {
    const definition = definitions.get(instance.definitionId);
    if (!definition) continue;
    const { electrical } = definition;
    if (electrical.kind !== "relay") continue;

    const { coil } = electrical.relay;
    const plusNet = netOf.get(terminalKey(instance.id, coil.positiveTerminal));
    const minusNet = netOf.get(terminalKey(instance.id, coil.negativeTerminal));
    if (plusNet === undefined || minusNet === undefined) continue;
    // コイルの両端が同じネット＝コイル自身が短絡されている。並列判定の意味がない
    if (plusNet === minusNet) continue;

    // 同じネット対に複数のコイルがぶら下がっていたら先勝ち。
    // ダイオード 1 個がそのすべてを保護しているので、代表 1 個を名前に使えば足りる
    const key = `${plusNet}|${minusNet}`;
    if (!index.has(key)) index.set(key, instance.id);
  }

  return index;
};

const biasOf = (
  anode: NetState | undefined,
  cathode: NetState | undefined,
): DiodeBias => {
  // 伝搬後は順方向のカソード側にも + が乗っているので、アノード側から見る
  if (reachesPlus(anode)) return "forward";
  if (reachesPlus(cathode)) return "reverse";
  return "none";
};

/**
 * ダイオード 1 個ずつの状態を読む。
 *
 * 警告（`validation.ts`）とプロパティパネル（`adapter/inspection.ts`）が
 * 同じ答えを見るように、判定はこの 1 箇所だけに置く。
 */
export const inspectDiodes = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
  lookup: NetLookup,
): DiodeInspection[] => {
  const edges = collectDiodeEdges(document, definitions, lookup.netOf);
  if (edges.length === 0) return [];

  const coils = coilNetIndex(document, definitions, lookup.netOf);

  return edges.map((edge) => {
    const anode = lookup.netState.get(edge.anodeNet);
    const cathode = lookup.netState.get(edge.cathodeNet);

    // 並列なコイルを探す。カソードがコイル + 側なら正しい向き
    const protective = coils.get(`${edge.cathodeNet}|${edge.anodeNet}`);
    const reversed = coils.get(`${edge.anodeNet}|${edge.cathodeNet}`);
    const relayId = protective ?? reversed;

    return {
      componentId: edge.componentId,
      bias: biasOf(anode, cathode),
      // **同じ 1 台の電源**をまたいでいるときだけ焼損する。別々の電源の
      // + と 0V をまたいでも、基準が繋がっていなければ電流は流れない
      shorting: spansSupply(anode, cathode),
      flyback:
        relayId === undefined
          ? undefined
          : {
              relayId,
              orientation: protective !== undefined ? "protective" : "reversed",
            },
    };
  });
};

/**
 * 位相制御調光器の AC の通り道を、伝搬用の有向辺として取り出す（design.md §4.15）。
 *
 * **union しない理由がここにある。** 入力と出力を同じネットにすると、
 * 同じ電源から取った 2 台の調光器の**出力回路まで 1 つに融合する** ——
 * 実機では別々の回路なのに、片方を絞るともう片方まで暗くなる。
 *
 * 代わりに、ダイオードと同じ「ネットは分けたまま電位だけ流す」形にする。
 * ダイオードと違うのは**両方向に流す**こと（交流の通り道は一方通行ではない）。
 * `spreadThroughDiodes` は `plusFrom` を anode → cathode、`zeroFrom` を
 * cathode → anode へ流すので、両向きの辺を入れれば両方が両方向へ伝わる。
 */
export const collectDimmerEdges = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
  netOf: ReadonlyMap<string, number>,
): DiodeEdge[] => {
  const edges: DiodeEdge[] = [];

  for (const instance of document.components) {
    const definition = definitions.get(instance.definitionId);
    if (!definition) continue;
    const { electrical } = definition;
    if (electrical.kind !== "dimmer") continue;

    const inNet = netOf.get(terminalKey(instance.id, electrical.inTerminal));
    const outNet = netOf.get(terminalKey(instance.id, electrical.outTerminal));
    if (inNet === undefined || outNet === undefined) continue;
    if (inNet === outNet) continue;

    edges.push({ componentId: instance.id, anodeNet: inNet, cathodeNet: outNet });
    edges.push({ componentId: instance.id, anodeNet: outNet, cathodeNet: inNet });
  }

  return edges;
};
