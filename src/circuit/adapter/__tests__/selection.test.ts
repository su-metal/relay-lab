/**
 * 範囲選択の当たり判定の検証（design.md §8.6）。
 *
 * 守りたいのは **配線そのものを枠で選べること。** React Flow の範囲選択は
 * 枠に入ったノードと、そのノードに繋がる Edge しか選ばないので、
 * 「電源とリレーを結ぶ長い 1 本を途中で囲んで消す」がここに掛かっている。
 *
 * `@xyflow/react` を実行時に import しないので node 環境でそのまま動く。
 */

import { describe, expect, it } from "vitest";

import {
  componentsInRect,
  connectionsInRect,
  connectionsOfComponents,
  terminalPoint,
} from "@/circuit/adapter/selection";
import { componentRegistry, dc24vPowerSupply } from "@/circuit/definitions";
import type { CircuitDocument } from "@/circuit/types";

/**
 * 電源 (0,0) 150×110 と ランプ (600,0) 140×130 を 1 本で結んだ回路。
 * 端子 `plus` は右辺の (150, 33)、ランプの端子 `1` は左辺の (600, 65) に来る。
 */
const document: CircuitDocument = {
  version: 1,
  components: [
    {
      id: "cmp-power",
      definitionId: "power-dc24v",
      label: "PS1",
      position: { x: 0, y: 0 },
    },
    {
      id: "cmp-lamp",
      definitionId: "lamp-dc24v",
      label: "L1",
      position: { x: 600, y: 0 },
    },
    // レジストリに無い定義。座標が出せないので判定から落ちる
    {
      id: "cmp-unknown",
      definitionId: "not-registered",
      position: { x: 0, y: 400 },
    },
  ],
  connections: [
    {
      id: "wire-1",
      from: { componentId: "cmp-power", terminalId: "plus" },
      to: { componentId: "cmp-lamp", terminalId: "1" },
    },
    {
      id: "wire-unknown",
      from: { componentId: "cmp-unknown", terminalId: "a" },
      to: { componentId: "cmp-lamp", terminalId: "2" },
    },
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
};

const flipped = (base: CircuitDocument): CircuitDocument => ({
  ...base,
  components: base.components.map((component) =>
    component.id === "cmp-power" ? { ...component, flipped: true } : component,
  ),
});

describe("terminalPoint", () => {
  it("相対座標と部品の寸法からキャンバス座標へ戻す", () => {
    expect(
      terminalPoint(
        { id: "cmp-power", definitionId: "power-dc24v", position: { x: 0, y: 0 } },
        dc24vPowerSupply,
        "plus",
      ),
    ).toEqual({ x: 150, y: 33 });
  });

  it("左右反転した部品では鏡像の位置を返す", () => {
    expect(
      terminalPoint(
        {
          id: "cmp-power",
          definitionId: "power-dc24v",
          position: { x: 0, y: 0 },
          flipped: true,
        },
        dc24vPowerSupply,
        "plus",
      ),
    ).toEqual({ x: 0, y: 33 });
  });
});

describe("componentsInRect", () => {
  it("枠にすっぽり収まった部品だけを選ぶ", () => {
    expect(
      componentsInRect(document, componentRegistry, {
        x: -20,
        y: -20,
        width: 200,
        height: 200,
      }),
    ).toEqual(["cmp-power"]);
  });

  it("かすっただけの部品は選ばない（囲んだつもりの無い部品を消さない）", () => {
    // 電源 (0,0)-(150,110) の左半分だけを覆う枠
    expect(
      componentsInRect(document, componentRegistry, {
        x: -20,
        y: -20,
        width: 100,
        height: 200,
      }),
    ).toEqual([]);
  });

  it("面積ゼロの枠（クリック）では何も選ばない", () => {
    expect(
      componentsInRect(document, componentRegistry, {
        x: -20,
        y: -20,
        width: 0,
        height: 200,
      }),
    ).toEqual([]);
  });

  it("定義が引けない部品は選ばない（描画もされていない）", () => {
    // cmp-unknown は (0,400) に居るが寸法が分からない
    expect(
      componentsInRect(document, componentRegistry, {
        x: -100,
        y: -100,
        width: 2000,
        height: 2000,
      }),
    ).toEqual(["cmp-power", "cmp-lamp"]);
  });
});

describe("connectionsInRect", () => {
  it("部品を 1 つも含まない枠でも、横切る配線を選ぶ", () => {
    // 電源（〜x150）ともランプ（x600〜）とも重ならない、線の途中だけの枠
    expect(
      connectionsInRect(document, componentRegistry, {
        x: 300,
        y: 0,
        width: 100,
        height: 100,
      }),
    ).toEqual(["wire-1"]);
  });

  it("配線から離れた枠では何も選ばない", () => {
    expect(
      connectionsInRect(document, componentRegistry, {
        x: 300,
        y: 300,
        width: 100,
        height: 100,
      }),
    ).toEqual([]);
  });

  it("面積ゼロの枠（クリック）では何も選ばない", () => {
    expect(
      connectionsInRect(document, componentRegistry, {
        x: 300,
        y: 0,
        width: 0,
        height: 100,
      }),
    ).toEqual([]);
  });

  it("左右反転を反映した位置で判定する", () => {
    // 電源の左肩。反転していなければ配線は x150 から右へ伸びるので届かない
    const rect = { x: 20, y: 20, width: 40, height: 30 };
    expect(connectionsInRect(document, componentRegistry, rect)).toEqual([]);
    expect(connectionsInRect(flipped(document), componentRegistry, rect)).toEqual(
      ["wire-1"],
    );
  });

  it("定義が引けない部品に繋がる配線は判定から落とす", () => {
    // ランプ全体を含む枠。wire-unknown もランプ側の端子を持つが座標が出せない
    expect(
      connectionsInRect(document, componentRegistry, {
        x: 550,
        y: -50,
        width: 300,
        height: 300,
      }),
    ).toEqual(["wire-1"]);
  });
});

describe("connectionsOfComponents", () => {
  it("片端でも選択中の部品に繋がっていれば拾う（React Flow と同じ規則）", () => {
    expect(connectionsOfComponents(document, ["cmp-lamp"])).toEqual([
      "wire-1",
      "wire-unknown",
    ]);
    expect(connectionsOfComponents(document, ["cmp-power"])).toEqual(["wire-1"]);
    expect(connectionsOfComponents(document, [])).toEqual([]);
  });
});
