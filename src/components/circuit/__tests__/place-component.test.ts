/**
 * タップ配置の座標計算（design.md §8.12）。
 *
 * 指の端末には D&D が無く、この関数がパレットから部品を置く唯一の経路になる。
 * 「見えている範囲の真ん中」を外すと、置いた部品が画面外に生まれて
 * **タップしても何も起きていないように見える。**
 */

import { describe, expect, it } from "vitest";

import { LAYOUT_GRID } from "@/circuit/adapter/auto-layout";

import {
  PLACE_CASCADE_STEP,
  panToInclude,
  placeAtViewportCenter,
} from "../place-component";

const PANE = { width: 800, height: 600 };
const VISUAL = { width: 200, height: 120 };

/** 置いた部品の中心（フロー座標） */
const centerOf = (position: { x: number; y: number }) => ({
  x: position.x + VISUAL.width / 2,
  y: position.y + VISUAL.height / 2,
});

/** 矩形どうしが重なっているか（辺が接しているだけは重なりとみなさない） */
const intersects = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

/** グリッド吸着ぶん（±半マス）を許して「ほぼここ」を見る */
const expectNear = (actual: number, expected: number) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(LAYOUT_GRID / 2);

describe("placeAtViewportCenter", () => {
  it("等倍・ずらし無しならペインの中心に部品の中心が来る", () => {
    const center = centerOf(
      placeAtViewportCenter({ x: 0, y: 0, zoom: 1 }, PANE, VISUAL),
    );

    expectNear(center.x, 400);
    expectNear(center.y, 300);
  });

  it("画面を動かした先の中心に置く（フロー座標へ戻す）", () => {
    // 画面を右下へずらす＝いま見えているフロー座標はその分だけ左上へ戻る
    const center = centerOf(
      placeAtViewportCenter({ x: 200, y: 100, zoom: 1 }, PANE, VISUAL),
    );

    expectNear(center.x, 400 - 200);
    expectNear(center.y, 300 - 100);
  });

  it("ズームを戻してフロー座標に直す", () => {
    const center = centerOf(
      placeAtViewportCenter({ x: 0, y: 0, zoom: 2 }, PANE, VISUAL),
    );

    // 画面中心 (400, 300) は 2 倍で見ているのでフロー座標の (200, 150)
    expectNear(center.x, 200);
    expectNear(center.y, 150);
  });

  it("グリッドに吸着する（置いた直後から整列して見える）", () => {
    const position = placeAtViewportCenter(
      { x: 3, y: 7, zoom: 1 },
      PANE,
      VISUAL,
    );

    expect(position.x % LAYOUT_GRID).toBe(0);
    expect(position.y % LAYOUT_GRID).toBe(0);
  });

  /**
   * **タップ配置で最も起きやすい事故。** 落とす位置を選べないので、
   * 続けて置くと同じ場所に重なり、1 個しか置けていないように見える。
   */
  it("重なる部品がある間は右下へずらし続ける", () => {
    const first = placeAtViewportCenter({ x: 0, y: 0, zoom: 1 }, PANE, VISUAL);
    const second = placeAtViewportCenter({ x: 0, y: 0, zoom: 1 }, PANE, VISUAL, [
      { ...first, ...VISUAL },
    ]);

    // ずらした先が矩形として離れている（左上がずれているだけでは足りない）
    expect(intersects({ ...second, ...VISUAL }, { ...first, ...VISUAL })).toBe(
      false,
    );
    // ずらし方はグリッドに沿った一定の刻みで、右下へ均等に流す
    expect((second.x - first.x) % PLACE_CASCADE_STEP).toBe(0);
    expect(second.x - first.x).toBe(second.y - first.y);
  });

  it("大きい部品の上に小さい部品を置いても抜け出すまでずらす", () => {
    const relay = { x: 0, y: 0, width: 260, height: 230 };
    const small = { width: 160, height: 140 };

    const position = placeAtViewportCenter(
      // ペインの中心がリレーのほぼ中心に来る見え方
      { x: PANE.width / 2 - 130, y: PANE.height / 2 - 115, zoom: 1 },
      PANE,
      small,
      [relay],
    );

    expect(intersects({ ...position, ...small }, relay)).toBe(false);
  });

  it("離れた場所の部品はずらす理由にならない", () => {
    const empty = placeAtViewportCenter({ x: 0, y: 0, zoom: 1 }, PANE, VISUAL);
    const withFarComponent = placeAtViewportCenter(
      { x: 0, y: 0, zoom: 1 },
      PANE,
      VISUAL,
      [{ x: empty.x + 500, y: empty.y, ...VISUAL }],
    );

    expect(withFarComponent).toEqual(empty);
  });
});

/**
 * 置いた部品が画面から出ないようにする（design.md §8.12）。
 *
 * 重なりを避けて右下へ流すと、携帯の幅ではすぐ枠の外へ出る。
 * **タップしたのに何も起きていないように見える**のがこの経路で最悪の失敗。
 */
describe("panToInclude", () => {
  const identity = { x: 0, y: 0, zoom: 1 };

  /** 変換とペインから、部品が画面のどこに描かれるかを出す */
  const screenRectOf = (
    transform: { x: number; y: number; zoom: number },
    rect: { x: number; y: number; width: number; height: number },
  ) => ({
    left: rect.x * transform.zoom + transform.x,
    top: rect.y * transform.zoom + transform.y,
    right: (rect.x + rect.width) * transform.zoom + transform.x,
    bottom: (rect.y + rect.height) * transform.zoom + transform.y,
  });

  it("収まっている部品では画面を動かさない", () => {
    const rect = { x: 100, y: 100, width: 200, height: 120 };
    expect(panToInclude(identity, PANE, rect)).toEqual(identity);
  });

  it("右下へはみ出した部品が枠に入るまで寄せる", () => {
    const rect = { x: 700, y: 550, width: 260, height: 230 };
    const panned = panToInclude(identity, PANE, rect);
    const screen = screenRectOf(panned, rect);

    expect(screen.right).toBeLessThanOrEqual(PANE.width);
    expect(screen.bottom).toBeLessThanOrEqual(PANE.height);
    // 寄せるのは最小限。倍率は変えない
    expect(panned.zoom).toBe(1);
  });

  it("左上へはみ出した部品も枠に入れる", () => {
    const rect = { x: -300, y: -200, width: 260, height: 230 };
    const screen = screenRectOf(panToInclude(identity, PANE, rect), rect);

    expect(screen.left).toBeGreaterThanOrEqual(0);
    expect(screen.top).toBeGreaterThanOrEqual(0);
  });

  it("拡大しているときも倍率のまま寄せる", () => {
    const rect = { x: 500, y: 400, width: 260, height: 230 };
    const panned = panToInclude({ x: 0, y: 0, zoom: 2 }, PANE, rect);
    const screen = screenRectOf(panned, rect);

    expect(panned.zoom).toBe(2);
    expect(screen.right).toBeLessThanOrEqual(PANE.width);
    expect(screen.bottom).toBeLessThanOrEqual(PANE.height);
  });

  /**
   * 横向きの携帯（キャンバスの高さ 244px）に MY4N（230px ＋端子ラベル）を
   * 置いた状況。**どう寄せても全体は見えないので動かさない** —— 片側へ
   * 寄せると逆側が余分に切れたうえ、図面まで動く。
   */
  it("画面に収まらない軸は動かさない（中央のまま切れさせる）", () => {
    const shortPane = { width: 750, height: 244 };
    const relay = { x: 100, y: 7, width: 260, height: 230 };
    const transform = { x: 0, y: 0, zoom: 1 };

    // 縦は収まらないので動かさない。横は収まっているので通常どおり
    expect(panToInclude(transform, shortPane, relay).y).toBe(transform.y);
    expect(panToInclude(transform, shortPane, relay).x).toBe(transform.x);
  });

  it("収まらない縦を抱えていても、はみ出した横は寄せる", () => {
    const shortPane = { width: 750, height: 244 };
    const relay = { x: 700, y: 7, width: 260, height: 230 };
    const panned = panToInclude({ x: 0, y: 0, zoom: 1 }, shortPane, relay);
    const screen = screenRectOf(panned, relay);

    expect(panned.y).toBe(0);
    expect(screen.right).toBeLessThanOrEqual(shortPane.width);
  });
});
