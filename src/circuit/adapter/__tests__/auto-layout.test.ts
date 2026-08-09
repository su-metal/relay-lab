/**
 * 配置の自動整理の検証（design.md §8.9）。
 *
 * 守りたいのは **描いた並びを壊さないこと。** 揃っているつもりのものを揃え、
 * 重なったものだけをほどく。意図して離した部品が引き寄せられたり、
 * 全部が 1 列に潰れたりしないことをここで押さえる。
 *
 * 寸法は実際の定義を使う（電源 150×130 / ランプ 140×160 / MY4N 260×240）。
 */

import { describe, expect, it } from "vitest";

import {
  ALIGN_TOLERANCE,
  LAYOUT_GAP,
  LAYOUT_GRID,
  arrangeComponents,
} from "@/circuit/adapter/auto-layout";
import { componentRegistry } from "@/circuit/definitions";
import type { CircuitDocument } from "@/circuit/types";

type Placed = { id: string; definitionId: string; x: number; y: number };

const documentOf = (placed: readonly Placed[]): CircuitDocument => ({
  version: 1,
  components: placed.map((item) => ({
    id: item.id,
    definitionId: item.definitionId,
    position: { x: item.x, y: item.y },
  })),
  connections: [],
  viewport: { x: 0, y: 0, zoom: 1 },
});

const arrange = (placed: readonly Placed[], targetIds?: readonly string[]) =>
  arrangeComponents(documentOf(placed), componentRegistry, targetIds);

describe("arrangeComponents — グリッド吸着", () => {
  it("部品の左上をグリッドへ乗せる", () => {
    const moved = arrange([
      { id: "a", definitionId: "power-dc24v", x: 103, y: 57 },
    ]);
    expect(moved.get("a")).toEqual({ x: 96, y: 64 });
  });

  it("既にグリッドに乗っていれば動かさない（履歴を汚さない）", () => {
    const moved = arrange([
      { id: "a", definitionId: "power-dc24v", x: 0, y: 0 },
      { id: "b", definitionId: "lamp-dc24v", x: 480, y: 320 },
    ]);
    expect(moved.size).toBe(0);
  });

  it("定義が引けない部品は動かさない", () => {
    const moved = arrange([
      { id: "unknown", definitionId: "not-registered", x: 103, y: 57 },
    ]);
    expect(moved.size).toBe(0);
  });
});

describe("arrangeComponents — 行・列の整列", () => {
  it("ほぼ揃った列を同じ x へ寄せる", () => {
    const moved = arrange([
      { id: "a", definitionId: "power-dc24v", x: 100, y: 0 },
      { id: "b", definitionId: "lamp-dc24v", x: 112, y: 400 },
      { id: "c", definitionId: "lamp-dc24v", x: 94, y: 800 },
    ]);
    const xs = ["a", "b", "c"].map((id) => moved.get(id)?.x ?? null);
    expect(new Set(xs).size).toBe(1);
    expect(xs[0]).toBe(96);
  });

  it("ほぼ揃った行を同じ y へ寄せる", () => {
    const moved = arrange([
      { id: "a", definitionId: "power-dc24v", x: 0, y: 200 },
      { id: "b", definitionId: "lamp-dc24v", x: 400, y: 214 },
    ]);
    expect(moved.get("b")?.y).toBe(moved.get("a")?.y ?? 208);
  });

  it("許容幅より離れた列は寄せない（意図した段違いを潰さない）", () => {
    const gap = ALIGN_TOLERANCE + LAYOUT_GRID;
    const moved = arrange([
      { id: "a", definitionId: "power-dc24v", x: 0, y: 0 },
      { id: "b", definitionId: "lamp-dc24v", x: gap, y: 400 },
    ]);
    expect(moved.get("b")?.x ?? gap).not.toBe(moved.get("a")?.x ?? 0);
  });

  it("少しずつずれた部品が数珠つなぎで 1 列に潰れない", () => {
    // 隣り合う差は許容幅ちょうど（32px）。1 つ前と比べるとすべて同じクラスタに
    // なってしまうが、クラスタの基準は先頭なので 3 個目は別の列に残る
    const step = ALIGN_TOLERANCE;
    const moved = arrange([
      { id: "a", definitionId: "power-dc24v", x: 0, y: 0 },
      { id: "b", definitionId: "power-dc24v", x: step, y: 400 },
      { id: "c", definitionId: "power-dc24v", x: step * 2, y: 800 },
    ]);
    const xs = ["a", "b", "c"].map((id, index) => moved.get(id)?.x ?? index * step);
    expect(xs[2]).not.toBe(xs[0]);
  });
});

describe("arrangeComponents — 重なりの解消", () => {
  it("重なった部品を下へ逃がす（上にある方は動かさない）", () => {
    const moved = arrange([
      { id: "a", definitionId: "power-dc24v", x: 0, y: 0 },
      // 許容幅より離れているので行としては揃わない。高さ 130 には食い込む
      { id: "b", definitionId: "power-dc24v", x: 0, y: 64 },
    ]);
    // 電源は高さ 130。0 + 130 + 32 = 162 をグリッドの下側へ丸めて 176
    expect(moved.get("b")).toEqual({ x: 0, y: 176 });
    expect(moved.has("a")).toBe(false);
  });

  it("逃がした先も空くまで繰り返す（3 個重ねても全部ほどける）", () => {
    const moved = arrange([
      { id: "a", definitionId: "power-dc24v", x: 0, y: 0 },
      { id: "b", definitionId: "power-dc24v", x: 0, y: 16 },
      { id: "c", definitionId: "power-dc24v", x: 0, y: 32 },
    ]);
    const ys = ["a", "b", "c"].map((id) => moved.get(id)?.y ?? 0);
    expect(ys[1]).toBeGreaterThanOrEqual(130 + LAYOUT_GAP);
    expect(ys[2]).toBeGreaterThanOrEqual(ys[1] + 130 + LAYOUT_GAP);
  });

  it("横に並んで重なっていない部品は下げない", () => {
    const moved = arrange([
      { id: "a", definitionId: "power-dc24v", x: 0, y: 0 },
      { id: "b", definitionId: "power-dc24v", x: 320, y: 0 },
    ]);
    expect(moved.size).toBe(0);
  });
});

describe("arrangeComponents — 対象の絞り込み", () => {
  it("選択した部品だけを動かす", () => {
    const moved = arrange(
      [
        { id: "a", definitionId: "power-dc24v", x: 103, y: 57 },
        { id: "b", definitionId: "lamp-dc24v", x: 503, y: 457 },
      ],
      ["a"],
    );
    expect(moved.has("a")).toBe(true);
    expect(moved.has("b")).toBe(false);
  });

  it("選択外の部品を障害物として避ける", () => {
    // b は選択外でその場に留まる。a を整列した先が b と重なるので、a が下へ逃げる
    const moved = arrange(
      [
        { id: "a", definitionId: "power-dc24v", x: 3, y: 5 },
        { id: "b", definitionId: "power-dc24v", x: 0, y: 0 },
      ],
      ["a"],
    );
    expect(moved.has("b")).toBe(false);
    expect(moved.get("a")?.y ?? 0).toBeGreaterThanOrEqual(130 + LAYOUT_GAP);
  });

  it("選択した ID がどれも存在しなければ何も返さない", () => {
    const moved = arrange(
      [{ id: "a", definitionId: "power-dc24v", x: 103, y: 57 }],
      ["missing"],
    );
    expect(moved.size).toBe(0);
  });
});
