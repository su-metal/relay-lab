/**
 * ネットの電位の読み取り（design.md §5.3）。
 *
 * 本エンジンは電圧値を持たず、ネットごとに「どの電源の + 側 / 0V 側に届くか」
 * （`NetState`）だけで判定する。その解釈をここ 1 箇所に閉じることで、
 * コイル（relay.ts）とランプ（simulate.ts）が同じ規則で判定されることを保証する。
 *
 * **電源ごとに持つのが要点。** 「+ 側に届く」「0V 側に届く」の 2 ビットにすると、
 * 基準を共有していない 2 台の電源をまたいだ負荷が通電と出る —— 実機では
 * 帰り道が無いので流れない。判定はすべて「**同じ 1 台の電源**の + と 0V に
 * 届いているか」に統一する。
 */

import type { NetState } from "@/circuit/types";

/** 交わりがあるか。空集合どうしでは false */
const intersects = (
  a: ReadonlySet<string>,
  b: ReadonlySet<string>,
): boolean => {
  // 小さい側を走査する。電源の台数は高々数台なので実質どちらでもよい
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const id of small) if (large.has(id)) return true;
  return false;
};

/**
 * このネットが短絡している電源。+ 側と 0V 側の両方に届いてしまっている電源。
 *
 * **1 台でも該当すれば電源短絡。** PS1 の + と PS2 の 0V が同じネットに乗るのは
 * 短絡ではない（基準が繋がっていないので電流は流れない）。逆に、直列接続した
 * 2 台の電源はこの判定を通らないので、正しく「短絡でない」と出る。
 */
export const shortedSupplies = (state: NetState | undefined): string[] => {
  if (!state) return [];
  const shorted: string[] = [];
  for (const id of state.plusFrom) if (state.zeroFrom.has(id)) shorted.push(id);
  return shorted;
};

/** 電源短絡しているネットか */
export const isShorted = (state: NetState | undefined): boolean =>
  shortedSupplies(state).length > 0;

/**
 * 電位の供給元として使える電源。
 *
 * 短絡している電源は除く —— そのネットは + にも 0V にも繋がっており、
 * 負荷にかかる電位差としては扱えない。
 */
const livePlus = (state: NetState | undefined): Set<string> => {
  const live = new Set<string>();
  if (!state) return live;
  for (const id of state.plusFrom) if (!state.zeroFrom.has(id)) live.add(id);
  return live;
};

const liveZero = (state: NetState | undefined): Set<string> => {
  const live = new Set<string>();
  if (!state) return live;
  for (const id of state.zeroFrom) if (!state.plusFrom.has(id)) live.add(id);
  return live;
};

/** どれか 1 台の電源の + 側に届いているか（配線色の表示に使う） */
export const reachesPlus = (state: NetState | undefined): boolean =>
  (state?.plusFrom.size ?? 0) > 0;

/** どれか 1 台の電源の 0V 側に届いているか */
export const reachesZero = (state: NetState | undefined): boolean =>
  (state?.zeroFrom.size ?? 0) > 0;

/**
 * + 側の電位にあるか。
 *
 * 短絡している電源は数えない（`livePlus`）。**単独では「どの電源の」が
 * 落ちるので、負荷の判定には使わない** —— 両端を突き合わせる
 * `polarityAcross` を使うこと。
 */
export const atPlus = (state: NetState | undefined): boolean =>
  livePlus(state).size > 0;

/** 0V 側の電位にあるか。`atPlus` と同じ制限がある */
export const atZero = (state: NetState | undefined): boolean =>
  liveZero(state).size > 0;

/** 2 端子間にかかる電位差の向き */
export type Polarity =
  /** a が + 側、b が 0V 側 */
  | "forward"
  /** a が 0V 側、b が + 側 */
  | "reverse"
  /** 電位差なし（どちらかが浮いている、同電位、または電源の基準が違う） */
  | "none";

/**
 * 負荷の両端 (a, b) にかかる電位差の向きを求める。
 *
 * 負荷はグラフ上で union されない（design.md §5.2）ので、
 * 「両端が異なる電源ネットに属するか」でしか通電を判定できない。
 *
 * **同じ 1 台の電源の + と 0V に届いていることを求める。** 別々の電源の
 * + と 0V をまたいでも、その 2 台の基準が繋がっていなければ電流は流れない。
 * 0V どうしを繋いだ 2 台は同じネットになるので、この判定を自然に通る。
 */
export const polarityAcross = (
  a: NetState | undefined,
  b: NetState | undefined,
): Polarity => {
  if (intersects(livePlus(a), liveZero(b))) return "forward";
  if (intersects(liveZero(a), livePlus(b))) return "reverse";
  return "none";
};

/**
 * a の + 側から b の 0V 側へ、**同じ電源をまたいでいるか**（短絡の判定用）。
 *
 * `polarityAcross` と違い、すでに短絡しているネットを除かない —— 焼損の
 * 警告（§5.4 のダイオード）は「そこがまさに短絡している」ことを言う側なので、
 * 短絡を理由に判定から外すと自分の根拠を消してしまう。
 */
export const spansSupply = (
  a: NetState | undefined,
  b: NetState | undefined,
): boolean =>
  a !== undefined && b !== undefined && intersects(a.plusFrom, b.zeroFrom);
