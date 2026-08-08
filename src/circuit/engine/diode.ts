/**
 * ダイオードの有向導通と向きの判定（design.md §5.4）。
 *
 * **ダイオードは今も union しない**（CLAUDE.md 設計原則 3・design.md §5.2）。
 * 一方通行を無向グラフの Union-Find で表せないという §5.4 の事情は変わっていない。
 * 代わりに、ネットを組み終えた後の電位をアノード → カソードの一方向にだけ流す。
 *
 * - `reachesPlus` は アノード側ネット → カソード側ネット へ伝わる（順方向探索）
 * - `reachesZero` は カソード側ネット → アノード側ネット へ伝わる（逆方向探索）
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
  states: Map<number, NetState>,
  edges: readonly DiodeEdge[],
): void => {
  if (edges.length === 0) return;

  for (let changed = true; changed; ) {
    changed = false;
    for (const edge of edges) {
      const anode = states.get(edge.anodeNet);
      const cathode = states.get(edge.cathodeNet);
      if (!anode || !cathode) continue;

      // 順方向：+ 側の電位はアノードからカソードへ抜ける
      if (anode.reachesPlus && !cathode.reachesPlus) {
        cathode.reachesPlus = true;
        changed = true;
      }
      // 逆方向探索：0V へ「戻れる」のもカソード側からアノード側だけ
      if (cathode.reachesZero && !anode.reachesZero) {
        anode.reachesZero = true;
        changed = true;
      }
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
   * 負荷を挟まずに + と 0V をまたいでいる。
   * `reachesPlus` がアノード側に、`reachesZero` がカソード側に届いている状態で、
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
  if (anode?.reachesPlus) return "forward";
  if (cathode?.reachesPlus) return "reverse";
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
      shorting: anode?.reachesPlus === true && cathode?.reachesZero === true,
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
