/**
 * ネットの電位の読み取り（design.md §5.3）。
 *
 * 本エンジンは電圧値を持たず、ネットごとの
 * `{ reachesPlus, reachesZero }` の 2 ビットだけで判定する。
 * 「+ 側にいる」「0V 側にいる」の解釈をここ 1 箇所に閉じることで、
 * コイル（relay.ts）とランプ（simulate.ts）が同じ規則で判定されることを保証する。
 */

import type { NetState } from "@/circuit/types";

/**
 * + 側の電位にあるか。
 *
 * 両方に到達しているネットは電源短絡（validation.ts が検出する）であり、
 * 負荷にかかる電位差としては扱わない。
 */
export const atPlus = (state: NetState | undefined): boolean =>
  state !== undefined && state.reachesPlus && !state.reachesZero;

/** 0V 側の電位にあるか。両方に到達しているネットは `atPlus` と同じ理由で除く */
export const atZero = (state: NetState | undefined): boolean =>
  state !== undefined && state.reachesZero && !state.reachesPlus;

/** 2 端子間にかかる電位差の向き */
export type Polarity =
  /** a が + 側、b が 0V 側 */
  | "forward"
  /** a が 0V 側、b が + 側 */
  | "reverse"
  /** 電位差なし（どちらかが浮いている、または同電位） */
  | "none";

/**
 * 負荷の両端 (a, b) にかかる電位差の向きを求める。
 *
 * 負荷はグラフ上で union されない（design.md §5.2）ので、
 * 「両端が異なる電源ネットに属するか」でしか通電を判定できない。
 */
export const polarityAcross = (
  a: NetState | undefined,
  b: NetState | undefined,
): Polarity => {
  if (atPlus(a) && atZero(b)) return "forward";
  if (atZero(a) && atPlus(b)) return "reverse";
  return "none";
};
