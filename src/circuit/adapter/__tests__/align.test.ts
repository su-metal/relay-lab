/**
 * 「揃える」の検証（design.md §8.13）。
 *
 * 守りたいのは **基準が読めること。** 左揃えならいちばん左の部品は動かず、
 * 均等なら両端が動かない。基準にした部品まで動くと「何に揃ったのか」が
 * 分からなくなる。あわせて、自動整理と違い**選択外へは絶対に触らない**ことと、
 * 選択が足りないときに空振り（履歴を汚さない）になることを押さえる。
 *
 * 寸法は実際の定義を使う（電源 150×130 / ランプ 140×160 / MY4N 260×240）。
 */

import { describe, expect, it } from "vitest";

import { alignComponents, minimumSelection } from "@/circuit/adapter/align";
import type { AlignMode } from "@/circuit/adapter/align";
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

const align = (
  placed: readonly Placed[],
  mode: AlignMode,
  targetIds: readonly string[] = placed.map((item) => item.id),
) => alignComponents(documentOf(placed), componentRegistry, targetIds, mode);

/** 電源 150×130 を 3 個、階段状に置いたもの */
const staircase: readonly Placed[] = [
  { id: "a", definitionId: "power-dc24v", x: 100, y: 100 },
  { id: "b", definitionId: "power-dc24v", x: 300, y: 200 },
  { id: "c", definitionId: "power-dc24v", x: 500, y: 300 },
];

describe("alignComponents — 端に揃える", () => {
  it("左揃えは、いちばん左の部品を動かさない", () => {
    const moved = align(staircase, "left");
    expect(moved.has("a")).toBe(false);
    expect(moved.get("b")).toEqual({ x: 100, y: 200 });
    expect(moved.get("c")).toEqual({ x: 100, y: 300 });
  });

  it("右揃えは、幅が違っても右端が揃う", () => {
    // 電源 150 幅・ランプ 140 幅。右端 = 400 に揃うので左上は 250 と 260
    const moved = align(
      [
        { id: "wide", definitionId: "power-dc24v", x: 250, y: 0 },
        { id: "narrow", definitionId: "lamp-dc24v", x: 100, y: 200 },
      ],
      "right",
    );
    expect(moved.has("wide")).toBe(false);
    expect(moved.get("narrow")).toEqual({ x: 260, y: 200 });
  });

  it("上揃えは y だけを動かし、x は触らない", () => {
    const moved = align(staircase, "top");
    expect(moved.get("b")).toEqual({ x: 300, y: 100 });
    expect(moved.get("c")).toEqual({ x: 500, y: 100 });
  });

  it("下揃えは、高さが違っても下端が揃う", () => {
    // 電源 130 高・ランプ 160 高。下端 = 330 に揃うので上端は 200 と 170
    const moved = align(
      [
        { id: "short", definitionId: "power-dc24v", x: 0, y: 200 },
        { id: "tall", definitionId: "lamp-dc24v", x: 300, y: 0 },
      ],
      "bottom",
    );
    expect(moved.has("short")).toBe(false);
    expect(moved.get("tall")).toEqual({ x: 300, y: 170 });
  });
});

describe("alignComponents — 中央に揃える", () => {
  it("左右中央は、幅が違っても中心が 1 本の線に乗る", () => {
    // 外接矩形は x=100〜560（MY4N 260 幅）。中心 330
    const moved = align(
      [
        { id: "power", definitionId: "power-dc24v", x: 100, y: 0 },
        { id: "relay", definitionId: "omron-my4n-dc24", x: 300, y: 300 },
      ],
      "center-x",
    );
    // 電源: 330 - 75 = 255 / リレー: 330 - 130 = 200
    expect(moved.get("power")).toEqual({ x: 255, y: 0 });
    expect(moved.get("relay")).toEqual({ x: 200, y: 300 });
    // 中心が一致していること
    expect(255 + 150 / 2).toBe(200 + 260 / 2);
  });

  it("上下中央も同じ考え方で y を揃える", () => {
    // 外接矩形は y=0〜260（ランプ 160 高が y=100 から）。中心 130
    const moved = align(
      [
        { id: "power", definitionId: "power-dc24v", x: 0, y: 0 },
        { id: "lamp", definitionId: "lamp-dc24v", x: 400, y: 100 },
      ],
      "center-y",
    );
    // 電源: 130 - 65 = 65 / ランプ: 130 - 80 = 50
    expect(moved.get("power")).toEqual({ x: 0, y: 65 });
    expect(moved.get("lamp")).toEqual({ x: 400, y: 50 });
  });

  it("既に中央が揃っていれば動かさない（履歴を汚さない）", () => {
    const moved = align(
      [
        { id: "a", definitionId: "power-dc24v", x: 100, y: 0 },
        { id: "b", definitionId: "power-dc24v", x: 100, y: 400 },
      ],
      "center-x",
    );
    expect(moved.size).toBe(0);
  });
});

describe("alignComponents — 均等（中心を等間隔に）", () => {
  it("両端は動かさず、真ん中の中心が等間隔になる", () => {
    const moved = align(
      [
        { id: "a", definitionId: "power-dc24v", x: 0, y: 0 },
        { id: "b", definitionId: "power-dc24v", x: 100, y: 0 },
        { id: "c", definitionId: "power-dc24v", x: 600, y: 0 },
      ],
      "distribute-x",
    );
    expect(moved.has("a")).toBe(false);
    expect(moved.has("c")).toBe(false);
    // 中心は 75 と 675。真ん中は 375 → 左上 300
    expect(moved.get("b")).toEqual({ x: 300, y: 0 });
  });

  it("幅が違っても、揃うのは中心の間隔", () => {
    // 電源 150（中心 75）/ MY4N 260 / ランプ 140（中心 800+70=870）
    const moved = align(
      [
        { id: "power", definitionId: "power-dc24v", x: 0, y: 0 },
        { id: "relay", definitionId: "omron-my4n-dc24", x: 200, y: 0 },
        { id: "lamp", definitionId: "lamp-dc24v", x: 800, y: 0 },
      ],
      "distribute-x",
    );
    // 中心は 75 と 870。真ん中の中心は 472.5 → 左上 472.5 - 130 = 342.5 → 343
    expect(moved.get("relay")).toEqual({ x: 343, y: 0 });
    expect(moved.has("power")).toBe(false);
    expect(moved.has("lamp")).toBe(false);
  });

  it("上下の均等は y だけを動かす", () => {
    const moved = align(
      [
        { id: "a", definitionId: "power-dc24v", x: 10, y: 0 },
        { id: "b", definitionId: "power-dc24v", x: 20, y: 100 },
        { id: "c", definitionId: "power-dc24v", x: 30, y: 600 },
      ],
      "distribute-y",
    );
    expect(moved.get("b")).toEqual({ x: 20, y: 300 });
  });

  it("並びが入力順に依存しない（同じ操作を 2 回押しても同じ結果）", () => {
    const forward = align(
      [
        { id: "a", definitionId: "power-dc24v", x: 0, y: 0 },
        { id: "b", definitionId: "power-dc24v", x: 100, y: 0 },
        { id: "c", definitionId: "power-dc24v", x: 600, y: 0 },
      ],
      "distribute-x",
    );
    const reversed = align(
      [
        { id: "c", definitionId: "power-dc24v", x: 600, y: 0 },
        { id: "b", definitionId: "power-dc24v", x: 100, y: 0 },
        { id: "a", definitionId: "power-dc24v", x: 0, y: 0 },
      ],
      "distribute-x",
    );
    expect(reversed.get("b")).toEqual(forward.get("b"));
  });
});

describe("alignComponents — 対象の切り出し", () => {
  it("選択外の部品は基準にも対象にもしない", () => {
    const moved = align(
      [
        { id: "a", definitionId: "power-dc24v", x: 300, y: 0 },
        { id: "b", definitionId: "power-dc24v", x: 400, y: 200 },
        // 選択外。いちばん左にあるが、ここには揃わない
        { id: "outside", definitionId: "power-dc24v", x: 0, y: 400 },
      ],
      "left",
      ["a", "b"],
    );
    expect(moved.has("outside")).toBe(false);
    expect(moved.get("b")).toEqual({ x: 300, y: 200 });
    expect(moved.has("a")).toBe(false);
  });

  it("定義が引けない部品は対象から外す", () => {
    const moved = align(
      [
        { id: "a", definitionId: "power-dc24v", x: 300, y: 0 },
        { id: "unknown", definitionId: "not-registered", x: 0, y: 200 },
      ],
      "left",
    );
    // 揃えられるのは 1 個だけになるので、最小選択数を満たさず空振り
    expect(moved.size).toBe(0);
  });
});

describe("alignComponents — 選択が足りないときは空振り", () => {
  it("揃えるは 2 個から。1 個では何も返さない", () => {
    expect(minimumSelection("left")).toBe(2);
    const moved = align(
      [{ id: "a", definitionId: "power-dc24v", x: 103, y: 57 }],
      "left",
    );
    expect(moved.size).toBe(0);
  });

  it("均等は 3 個から。2 個では何も返さない", () => {
    expect(minimumSelection("distribute-x")).toBe(3);
    const moved = align(
      [
        { id: "a", definitionId: "power-dc24v", x: 0, y: 0 },
        { id: "b", definitionId: "power-dc24v", x: 600, y: 0 },
      ],
      "distribute-x",
    );
    expect(moved.size).toBe(0);
  });

  it("選択が空なら、図面が潰れずに空振りする", () => {
    const moved = align(staircase, "left", []);
    expect(moved.size).toBe(0);
  });
});

describe("alignComponents — 重なりは解消しない", () => {
  it("左揃えで縦に重なっても、下へ逃がさない（自動整理の役目）", () => {
    // 電源は 130 高。y が 40 しか離れていないので重なる
    const moved = align(
      [
        { id: "a", definitionId: "power-dc24v", x: 100, y: 0 },
        { id: "b", definitionId: "power-dc24v", x: 300, y: 40 },
      ],
      "left",
    );
    // y は 40 のまま。重なりを承知で揃える
    expect(moved.get("b")).toEqual({ x: 100, y: 40 });
  });
});
