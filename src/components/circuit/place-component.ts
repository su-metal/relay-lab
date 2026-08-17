/**
 * タップで置いた部品の座標（design.md §8.12）。
 *
 * 指で操作する端末には**ドラッグ＆ドロップが無い。** HTML5 の DnD
 * （`dragstart` / `drop`）はマウス専用で、パレットから摘まむ操作がそのまま
 * 死ぬ。そこで「タップした部品を、いま見えている範囲の真ん中へ置く」経路を
 * 用意する。
 *
 * **React Flow も React も import しない。** 受け取るのは画面の変換行列と
 * 大きさだけの純粋関数なので、UI を起動せずに Vitest で検証できる
 * （CLAUDE.md 設計原則 1 と同じ考え方を表示側にも通す）。
 */

import { LAYOUT_GRID } from "@/circuit/adapter/auto-layout";

/** 自動整理（§8.9）と同じグリッドへ吸着させる。置いた直後から揃って見える */
const snapToGrid = (value: number): number =>
  Math.round(value / LAYOUT_GRID) * LAYOUT_GRID;

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type Rect = Point & Size;

/** React Flow の変換（`x` / `y` は画面のずらし量、`zoom` は倍率） */
export type ViewportTransform = { x: number; y: number; zoom: number };

/**
 * 同じ場所へ続けて置いたときのずらし量。
 *
 * **重ねない。** タップで置くと落とす位置を選べないので、続けて 3 個置くと
 * 完全に重なって「1 個しか置けていない」ように見える。グリッド 2 マスずつ
 * 右下へ流し、後から `▦ 配置を整列`（§8.9）で揃えられる位置に落とす。
 */
export const PLACE_CASCADE_STEP = LAYOUT_GRID * 2;

/** ずらしの打ち切り。これ以上は空きを探さず、最後の位置に置く */
const MAX_CASCADE = 24;

/**
 * 重なりの判定は**矩形どうし**で見る。
 *
 * 左上の座標だけを比べると、リレー（260×230）の上に電源（180×140）が
 * ほとんど乗った状態を「ずれているから別の場所」と数えてしまう。
 * 辺が接しているだけ（座標が等しい）は重なりとみなさない ——
 * `auto-layout.ts` の `overlaps()` と同じ約束。
 */
const intersects = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

/**
 * いま見えている範囲の中心へ部品を置く座標（部品の左上）を返す。
 *
 * `pane` は React Flow のペインの実寸（`useStore` の `width` / `height`）。
 * 画面座標 → フロー座標は `(screen - transform) / zoom`。**部品の中心が
 * 画面の中心に来るように**左上へ寄せるのは、ドロップ時（`CircuitCanvas`）と
 * 同じ約束。
 *
 * `taken` には既存の部品の矩形（左上と大きさ）を渡す。重なるあいだ右下へ
 * ずらし続ける。
 */
export function placeAtViewportCenter(
  transform: ViewportTransform,
  pane: Size,
  visual: Size,
  taken: readonly Rect[] = [],
): Point {
  const zoom = transform.zoom || 1;
  const centerX = (pane.width / 2 - transform.x) / zoom;
  const centerY = (pane.height / 2 - transform.y) / zoom;

  let candidate: Point = {
    x: snapToGrid(centerX - visual.width / 2),
    y: snapToGrid(centerY - visual.height / 2),
  };

  for (let step = 0; step < MAX_CASCADE; step++) {
    const rect = { ...candidate, ...visual };
    if (!taken.some((other) => intersects(rect, other))) break;
    candidate = {
      x: candidate.x + PLACE_CASCADE_STEP,
      y: candidate.y + PLACE_CASCADE_STEP,
    };
  }

  return candidate;
}

/** 置いた部品と画面の端のあいだに残す余白（px） */
const VIEW_MARGIN = 24;

/**
 * 置いた部品が画面に収まるところまで、**最小限だけ**画面を動かした変換を返す。
 *
 * 重なりを避けて右下へ流した部品は、携帯の幅（リレー 1 個で画面の 3 分の 2）では
 * すぐ画面の外へ出る。**タップしたのに何も起きていないように見える**のが
 * この経路でいちばん困る失敗なので、はみ出したぶんだけ画面を寄せる。
 *
 * 倍率は変えない（勝手に縮むと、いま読んでいた端子番号が読めなくなる）。
 * 収まっているなら**変換をそのまま返す** —— 呼び出し側はこれを見て
 * 「動かす必要が無かった」と判断できる。
 */
export function panToInclude(
  transform: ViewportTransform,
  pane: Size,
  rect: Rect,
): ViewportTransform {
  const zoom = transform.zoom || 1;

  const fit = (
    offset: number,
    start: number,
    length: number,
    paneLength: number,
  ): number => {
    const screenStart = start * zoom + offset;
    const screenEnd = screenStart + length * zoom;

    // 左（上）へはみ出しているならそちらを優先して寄せる
    if (screenStart < VIEW_MARGIN) return offset + (VIEW_MARGIN - screenStart);

    const overflow = screenEnd - (paneLength - VIEW_MARGIN);
    if (overflow > 0) {
      // **画面より大きい部品では左（上）を切らない。** 両端は同時に満たせず、
      // 端子番号を読み始める側（左上）を残すほうが図面として使える
      return offset - Math.min(overflow, screenStart - VIEW_MARGIN);
    }

    return offset;
  };

  return {
    x: fit(transform.x, rect.x, rect.width, pane.width),
    y: fit(transform.y, rect.y, rect.height, pane.height),
    zoom,
  };
}
