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

import {
  LANE_STEP,
  STRAIGHT_LANE_STEP,
  buildWireLanes,
  laneShift,
  straightRunPath,
} from "@/circuit/adapter/wire-lane";
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

/** 部品の上端から端子までの距離。定義から引くので `visual` を変えても追随する */
const terminalOffsetY = (definitionId: string, terminalId: string): number => {
  const definition = componentRegistry.get(definitionId);
  if (!definition) throw new Error(`未登録の定義: ${definitionId}`);
  const terminal = definition.terminals.find(
    (candidate) => candidate.id === terminalId,
  );
  if (!terminal) throw new Error(`未登録の端子: ${terminalId}`);
  return terminal.position.y * definition.visual.height;
};

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

  it("間隔を指定できる（迂回した走行は幹線より広く取る）", () => {
    expect(laneShift(1, STRAIGHT_LANE_STEP)).toBe(STRAIGHT_LANE_STEP);
    expect(laneShift(2, STRAIGHT_LANE_STEP)).toBe(-STRAIGHT_LANE_STEP);
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

  it("同じ辺どうしの配線も、出口の高さが重なれば離す", () => {
    /*
     * 右辺 → 右辺。smoothstep は中点を使わず、**出口の高さのまま相手の真横まで
     * 走って**から折れる。同じ端子から出る配線は走行が全部同じ高さに立つので、
     * 電源のレールから複数の負荷へ渡すとピクセル単位で重なる。
     */
    const document = circuit(
      [0, 100],
      [
        wire("w1", ["ps", "plus"], ["l1", "2"]),
        wire("w2", ["ps", "plus"], ["l2", "2"]),
      ],
    );

    const lanes = buildWireLanes(document, componentRegistry);
    const shifts = [lanes.get("w1") ?? 0, lanes.get("w2") ?? 0];
    expect(new Set(shifts).size).toBe(2);
    // 画面を横断する走行は幹線より広く離す（発光が触れて 1 本に見えないよう）
    expect(Math.abs(shifts[0] - shifts[1])).toBeGreaterThanOrEqual(
      STRAIGHT_LANE_STEP,
    );
  });

  it("相手に背を向けて出る配線は対象外", () => {
    // 電源を右に置き、左のランプへ渡す。走行が相手側の座標に立ち、幹線の
    // 見立てが変わるので手を出さない（回り込む形）
    const document: CircuitDocument = {
      version: 1,
      components: [
        { id: "ps", definitionId: "power-dc24v", position: { x: 600, y: 0 } },
        { id: "l1", definitionId: "lamp-dc24v", position: { x: 0, y: 0 } },
        { id: "l2", definitionId: "lamp-dc24v", position: { x: 0, y: 100 } },
      ],
      connections: [
        wire("w1", ["ps", "plus"], ["l1", "2"]),
        wire("w2", ["ps", "plus"], ["l2", "2"]),
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    expect(buildWireLanes(document, componentRegistry).size).toBe(0);
  });

  it("真っ直ぐ向かい合う配線どうしも離す", () => {
    /*
     * 電源の + と同じ高さに、ランプの端子 1 が来る位置へ 2 台。どちらも
     * 完全な水平線になり、`getSmoothStepPath` は直線を返す —— 幹線が無いので、
     * 以前は 2 本がピクセル単位で重なったままだった。
     *
     * y は定義から逆算する。定数を書き写すと `visual` を変えたときに
     * 「真っ直ぐ」でなくなり、テストだけが古い前提のまま通る
     */
    const alignedY = terminalOffsetY("power-dc24v", "plus") -
      terminalOffsetY("lamp-dc24v", "1");
    const document: CircuitDocument = {
      version: 1,
      components: [
        { id: "ps", definitionId: "power-dc24v", position: { x: 0, y: 0 } },
        {
          id: "l1",
          definitionId: "lamp-dc24v",
          position: { x: 600, y: alignedY },
        },
        {
          id: "l2",
          definitionId: "lamp-dc24v",
          position: { x: 900, y: alignedY },
        },
      ],
      connections: [
        wire("w1", ["ps", "plus"], ["l1", "1"]),
        wire("w2", ["ps", "plus"], ["l2", "1"]),
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    const lanes = buildWireLanes(document, componentRegistry);
    const shifts = [lanes.get("w1") ?? 0, lanes.get("w2") ?? 0];
    expect(new Set(shifts).size).toBe(2);
    expect(Math.abs(shifts[0] - shifts[1])).toBeGreaterThanOrEqual(
      STRAIGHT_LANE_STEP,
    );
  });

  it("真っ直ぐでも 1 本きりなら動かさない", () => {
    const document: CircuitDocument = {
      version: 1,
      components: [
        { id: "ps", definitionId: "power-dc24v", position: { x: 0, y: 0 } },
        { id: "l1", definitionId: "lamp-dc24v", position: { x: 600, y: -32 } },
        { id: "l2", definitionId: "lamp-dc24v", position: { x: 600, y: 400 } },
      ],
      connections: [
        wire("w1", ["ps", "plus"], ["l1", "1"]),
        wire("w2", ["ps", "zero"], ["l2", "1"]),
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    };

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

/**
 * 真っ直ぐな配線を逃がす経路（design.md §8.7）。
 *
 * `buildWireLanes` がレーンを配っても、経路がそれを実現しなければ線は動かない。
 * **ここが `null` を返す条件と `trunkOf` の分岐は一致していなければならない**
 * ―― ずれると「レーンは配られたのに線は直線のまま」になる。
 */
describe("straightRunPath", () => {
  const horizontal = {
    source: { x: 0, y: 0 },
    target: { x: 200, y: 0 },
    sourceSide: "right",
    targetSide: "left",
  } as const;

  it("逃がす量が 0 なら経路を作らない（smoothstep に任せる）", () => {
    expect(straightRunPath({ ...horizontal, offset: 0 })).toBeNull();
  });

  it("向かい合っていて高さがずれていれば対象外（中点をずらす経路で足りる）", () => {
    expect(
      straightRunPath({
        ...horizontal,
        target: { x: 200, y: 40 },
        offset: 10,
      }),
    ).toBeNull();
  });

  it("相手に背を向けて出る配線は対象外", () => {
    // 右へ出るのに相手は左。走行が相手側の座標に立つ
    expect(
      straightRunPath({
        ...horizontal,
        target: { x: -200, y: 0 },
        targetSide: "right",
        offset: 10,
      }),
    ).toBeNull();
  });

  it("同じ辺どうしなら、高さがずれていても逃がす", () => {
    /*
     * 右辺 → 右辺。出口の高さ（y=0）のまま相手の真横（x=220）まで走り、
     * そこから折れて相手の右辺へ入る。逃がすのは走行の高さ
     */
    const path = straightRunPath({
      ...horizontal,
      target: { x: 200, y: 120 },
      targetSide: "right",
      offset: 10,
    });

    expect(path?.startsWith("M 0,0")).toBe(true);
    expect(path?.endsWith("L 200,120")).toBe(true);
    // 逃げた走行（y=10）は、相手の右横（x=220）まで伸びる
    expect(path).toContain("25,10");
    expect(path).toContain("215,10");
  });

  it("端子から出る区間しか無い短い配線は曲げない", () => {
    expect(
      straightRunPath({ ...horizontal, target: { x: 50, y: 0 }, offset: 10 }),
    ).toBeNull();
  });

  it("端子から出て、逃がした高さを走り、元の高さへ戻る", () => {
    const path = straightRunPath({ ...horizontal, offset: 10 });

    // 端子そのものは動かさない。動かすと配線が端子から浮く
    expect(path?.startsWith("M 0,0")).toBe(true);
    expect(path?.endsWith("L 200,0")).toBe(true);
    // 逃がした高さ（y=10）を走っている
    expect(path).toContain("25,10");
    expect(path).toContain("175,10");
  });

  it("上下の端子でも同じ形になる（走行が縦になるだけ）", () => {
    const path = straightRunPath({
      source: { x: 0, y: 0 },
      target: { x: 0, y: 200 },
      sourceSide: "bottom",
      targetSide: "top",
      offset: -10,
    });

    expect(path?.startsWith("M 0,0")).toBe(true);
    expect(path?.endsWith("L 0,200")).toBe(true);
    // 逃がすのは x 側。符号もそのまま効く
    expect(path).toContain("-10,25");
    expect(path).toContain("-10,175");
  });
});
