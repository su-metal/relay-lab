/**
 * 配線のレーン分離の検証（design.md §8.7）。
 *
 * 守りたいのは 2 つ。**同じ道に重なって走る配線は必ず離れること**と、
 * **重なっていない配線は動かさないこと。** 後者が崩れると、混んでもいない
 * 場所の線まで部品からずれて図面が読みにくくなる。
 *
 * 座標は実際の部品定義から計算する。定数を書き写すと、`visual` や端子位置を
 * 変えたときにテストだけが古い前提のまま通ってしまう。
 */

import { describe, expect, it } from "vitest";

import { LANE_STEP, buildWireLanes, laneShift } from "@/circuit/adapter/wire-lane";
import { componentRegistry } from "@/circuit/definitions";
import type { CircuitConnection, CircuitDocument } from "@/circuit/types";

/**
 * 電源 1 台とランプ 2 台。ランプの y だけを引数で動かして、
 * 「配線が重なる配置」と「重ならない配置」を作り分ける。
 *
 * 電源 (0,0) 150×110 の `plus` は右辺 (150, 33)・`zero` は右辺 (150, 77)。
 * ランプ 140×130 の端子 `1` は左辺の中央、`2` は右辺の中央。
 */
const circuit = (
  lampY: readonly [number, number],
  connections: readonly CircuitConnection[],
): CircuitDocument => ({
  version: 1,
  components: [
    { id: "ps", definitionId: "power-dc24v", position: { x: 0, y: 0 } },
    { id: "l1", definitionId: "lamp-dc24v", position: { x: 600, y: lampY[0] } },
    { id: "l2", definitionId: "lamp-dc24v", position: { x: 600, y: lampY[1] } },
  ],
  connections: [...connections],
  viewport: { x: 0, y: 0, zoom: 1 },
});

const wire = (
  id: string,
  from: [string, string],
  to: [string, string],
): CircuitConnection => ({
  id,
  from: { componentId: from[0], terminalId: from[1] },
  to: { componentId: to[0], terminalId: to[1] },
});

describe("laneShift", () => {
  it("中央から左右交互に振る", () => {
    // 片側へ積むと束全体が元の位置から離れていく
    expect(laneShift(0)).toBe(0);
    expect(laneShift(1)).toBe(LANE_STEP);
    expect(laneShift(2)).toBe(-LANE_STEP);
    expect(laneShift(3)).toBe(LANE_STEP * 2);
    expect(laneShift(4)).toBe(-LANE_STEP * 2);
  });
});

describe("buildWireLanes", () => {
  it("配線が 1 本以下なら何もずらさない", () => {
    const document = circuit([0, 200], [wire("w1", ["ps", "plus"], ["l1", "1"])]);
    expect(buildWireLanes(document, componentRegistry).size).toBe(0);
  });

  it("幹線が重なる 2 本を離す", () => {
    // 電源からランプへ交差して渡る 2 本。幹線はどちらも x=375 に立ち、
    // y の範囲も重なるので、そのままでは 1 本に見える
    const document = circuit(
      [0, 200],
      [
        wire("w1", ["ps", "plus"], ["l2", "1"]),
        wire("w2", ["ps", "zero"], ["l1", "1"]),
      ],
    );

    const lanes = buildWireLanes(document, componentRegistry);
    const shifts = [lanes.get("w1") ?? 0, lanes.get("w2") ?? 0];
    expect(new Set(shifts).size).toBe(2);
    expect(Math.abs(shifts[0] - shifts[1])).toBeGreaterThanOrEqual(LANE_STEP);
  });

  it("同じ端子から出る複数の配線も離す", () => {
    // 電源の + から 2 台へ分岐する形。ラダー図でいちばん多く出る重なり
    const document = circuit(
      [0, 100],
      [
        wire("w1", ["ps", "plus"], ["l1", "1"]),
        wire("w2", ["ps", "plus"], ["l2", "1"]),
      ],
    );

    const lanes = buildWireLanes(document, componentRegistry);
    expect(new Set([lanes.get("w1") ?? 0, lanes.get("w2") ?? 0]).size).toBe(2);
  });

  it("重なっていない配線は動かさない", () => {
    // ランプを離して置き、2 本の幹線が y の範囲で交わらないようにする。
    // 幹線の位置（x=375）は同じでも、上下に分かれていれば読み分けられる
    const document = circuit(
      [0, 400],
      [
        wire("w1", ["ps", "plus"], ["l1", "1"]),
        wire("w2", ["ps", "zero"], ["l2", "1"]),
      ],
    );

    expect(buildWireLanes(document, componentRegistry).size).toBe(0);
  });

  it("ずらす余地が無いほど部品が近ければ動かさない", () => {
    // 幹線を動かすと経路が折り返し、重なり以上に読みにくい線になる
    const document = {
      ...circuit(
        [0, 40],
        [
          wire("w1", ["ps", "plus"], ["l1", "1"]),
          wire("w2", ["ps", "plus"], ["l2", "1"]),
        ],
      ),
      components: [
        { id: "ps", definitionId: "power-dc24v", position: { x: 0, y: 0 } },
        { id: "l1", definitionId: "lamp-dc24v", position: { x: 190, y: 0 } },
        { id: "l2", definitionId: "lamp-dc24v", position: { x: 190, y: 40 } },
      ],
    } satisfies CircuitDocument;

    expect(buildWireLanes(document, componentRegistry).size).toBe(0);
  });

  it("向かい合っていない端子どうしの配線は対象外", () => {
    // 右辺 → 右辺 の配線では smoothstep が中点を使わないので、ずらす手段が無い
    const document = circuit(
      [0, 20],
      [
        wire("w1", ["ps", "plus"], ["l1", "2"]),
        wire("w2", ["ps", "zero"], ["l2", "2"]),
      ],
    );

    expect(buildWireLanes(document, componentRegistry).size).toBe(0);
  });

  it("座標が出せない配線は黙って外す", () => {
    const document: CircuitDocument = {
      version: 1,
      components: [
        { id: "ps", definitionId: "power-dc24v", position: { x: 0, y: 0 } },
        { id: "l1", definitionId: "lamp-dc24v", position: { x: 600, y: 0 } },
        { id: "ghost", definitionId: "not-registered", position: { x: 0, y: 0 } },
      ],
      connections: [
        wire("w1", ["ps", "plus"], ["l1", "1"]),
        wire("w2", ["ghost", "a"], ["l1", "2"]),
        wire("w3", ["ps", "zero"], ["l1", "nope"]),
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    expect(() => buildWireLanes(document, componentRegistry)).not.toThrow();
    expect(buildWireLanes(document, componentRegistry).has("w2")).toBe(false);
    expect(buildWireLanes(document, componentRegistry).has("w3")).toBe(false);
  });
});
