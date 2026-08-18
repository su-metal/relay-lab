/**
 * 配線のレーン分離の検証（design.md §8.7）。
 *
 * 守りたいのは 3 つ。**同じ道に重なって走る配線は必ず離れること**、
 * **部品の本体を横切らないこと**、そして **横切ってもいない配線を動かさないこと。**
 * 最後が崩れると、混んでもいない場所の線まで部品からずれて図面が読みにくくなる。
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

  it("負荷から電源へ引き戻した配線も離す（走行は電源側の高さに立つ）", () => {
    /*
     * **引いた向きで走行の高さが変わる。** 負荷 → 電源と引くと、出口
     * （ランプの右辺）は電源に背を向けているので、`getSmoothStepPath` は
     * いったん右へ出てから**電源の高さ**まで降り、そこを左へ走る。
     * 3 本とも 0V の高さに重なるので、ここを離せないと意味が無い。
     */
    const document: CircuitDocument = {
      version: 1,
      components: [
        { id: "ps", definitionId: "power-dc24v", position: { x: 0, y: 300 } },
        { id: "l1", definitionId: "lamp-dc24v", position: { x: 700, y: 0 } },
        { id: "l2", definitionId: "lamp-dc24v", position: { x: 700, y: 300 } },
        { id: "l3", definitionId: "lamp-dc24v", position: { x: 700, y: 600 } },
      ],
      connections: [
        wire("w1", ["l1", "2"], ["ps", "zero"]),
        wire("w2", ["l2", "2"], ["ps", "zero"]),
        wire("w3", ["l3", "2"], ["ps", "zero"]),
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    const lanes = buildWireLanes(document, componentRegistry);
    const shifts = [
      lanes.get("w1") ?? 0,
      lanes.get("w2") ?? 0,
      lanes.get("w3") ?? 0,
    ];
    expect(new Set(shifts).size).toBe(3);
  });

  it("向かい合ったまま回り込む配線は従来の幹線として扱う", () => {
    /*
     * 右辺 → 左辺で、相手が左にいる形。中点（centerY）で動かせるので
     * 走行として扱わない。
     *
     * **部品を大きく離してあるのは、避ける動き（§8.7）と混ざらないため。**
     * 幹線は両端の中点の高さに立つので、部品が近いとその高さが本体に重なり、
     * 「跨がない」ほうの規則が先に効いてレーンの間隔で振られなくなる。
     * ここで見たいのは間隔なので、本体を横切らない位置に置く。
     *
     * 幹線の高さは w1 が (39 + 1132) / 2、w2 が (91 + 1080) / 2 で
     * どちらも 585.5 —— 同じ束に入りつつ、どの部品の本体にもかからない。
     */
    const document: CircuitDocument = {
      version: 1,
      components: [
        { id: "ps", definitionId: "power-dc24v", position: { x: 600, y: 0 } },
        { id: "l1", definitionId: "lamp-dc24v", position: { x: 0, y: 1052 } },
        { id: "l2", definitionId: "lamp-dc24v", position: { x: 0, y: 1000 } },
      ],
      connections: [
        wire("w1", ["ps", "plus"], ["l1", "1"]),
        wire("w2", ["ps", "zero"], ["l2", "1"]),
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    const lanes = buildWireLanes(document, componentRegistry);
    // 重なっているので必ず 1 本はずれる（空振りで素通りしないことを押さえる）
    expect(lanes.size).toBeGreaterThan(0);
    for (const shift of lanes.values()) {
      // 幹線の間隔で振られている（走行の 16px ではない）
      expect(Math.abs(shift) % LANE_STEP).toBe(0);
    }
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

  it("相手に背を向けて出る配線は、相手側の高さで走行を逃がす", () => {
    /*
     * 右へ出るのに相手は左（負荷 → 電源の引き方）。出口の高さ（y=0）ではなく
     * **相手の高さ（y=120）** を走るので、逃がすのもそちら側。
     */
    const path = straightRunPath({
      source: { x: 0, y: 0 },
      target: { x: -300, y: 120 },
      sourceSide: "right",
      targetSide: "right",
      offset: 10,
    });

    expect(path?.startsWith("M 0,0")).toBe(true);
    expect(path?.endsWith("L -300,120")).toBe(true);
    // 走行は相手の高さ +10。出口の高さ（0 + 10 = 10）ではない
    expect(path).toContain(",130");
    expect(path).not.toContain(",10Q");
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

/**
 * 部品を跨がない（design.md §8.7）。
 *
 * 幹線・走行が部品の本体を突っ切ると、線と型番・端子番号が重なって
 * どちらも読めなくなる。**横切っているときだけ**外へ逃がす。
 */
describe("buildWireLanes — 部品を避ける", () => {
  /** 幹線が本体の中を通っていないか。`x` 側を見るか `y` 側を見るかは呼び出し側が決める */
  const insideBody = (
    value: number,
    min: number,
    max: number,
  ): boolean => value > min && value < max;

  it("同じ部品の上下の端子を結ぶ線は、本体を突っ切らずに回り込む", () => {
    /*
     * MY4N（260×240）の上辺の端子と下辺の端子を 1 本で結ぶ。素直に引くと
     * 走行が本体を縦に貫通する —— 型番も接点図も端子番号も線に潰される。
     */
    const document: CircuitDocument = {
      version: 1,
      components: [
        { id: "ry", definitionId: "omron-my4n-dc24", position: { x: 400, y: 0 } },
      ],
      // MY4N の 1（上辺）と 5（下辺）
      connections: [wire("w1", ["ry", "1"], ["ry", "5"])],
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    const definition = componentRegistry.get("omron-my4n-dc24")!;
    const terminal = definition.terminals.find((t) => t.id === "1")!;
    const naturalX = 400 + terminal.position.x * definition.visual.width;
    // そもそも本体の中を通る位置に立っていること（前提の確認）
    expect(insideBody(naturalX, 400, 400 + definition.visual.width)).toBe(true);

    const shift = buildWireLanes(document, componentRegistry).get("w1") ?? 0;
    expect(shift).not.toBe(0);
    expect(
      insideBody(naturalX + shift, 400, 400 + definition.visual.width),
    ).toBe(false);
  });

  it("横切っていない配線は 1px も動かさない", () => {
    /*
     * 電源の右端子からランプの左端子へ、間に何も無い並び。
     * 避ける理由が無いので、レーンも避けも何も配られない。
     */
    const document: CircuitDocument = {
      version: 1,
      components: [
        { id: "ps", definitionId: "power-dc24v", position: { x: 0, y: 0 } },
        { id: "l1", definitionId: "lamp-dc24v", position: { x: 400, y: 0 } },
      ],
      connections: [wire("w1", ["ps", "plus"], ["l1", "1"])],
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    expect(buildWireLanes(document, componentRegistry).size).toBe(0);
  });

  it("間に挟まった部品も跨がない", () => {
    /*
     * 電源 → ランプの間にリレーを置く。走行はリレーの本体を横切るので、
     * 上か下へ逃げる。
     */
    const relay = componentRegistry.get("omron-my4n-dc24")!;
    const document: CircuitDocument = {
      version: 1,
      components: [
        { id: "ps", definitionId: "power-dc24v", position: { x: 0, y: 0 } },
        { id: "ry", definitionId: "omron-my4n-dc24", position: { x: 300, y: 0 } },
        { id: "l1", definitionId: "lamp-dc24v", position: { x: 800, y: 0 } },
      ],
      // 右辺 → 右辺。走行は電源の plus の高さに立ち、リレーの本体を横切る
      connections: [wire("w1", ["ps", "plus"], ["l1", "2"])],
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    const power = componentRegistry.get("power-dc24v")!;
    const plus = power.terminals.find((t) => t.id === "plus")!;
    const runY = plus.position.y * power.visual.height;
    expect(insideBody(runY, 0, relay.visual.height)).toBe(true);

    const shift = buildWireLanes(document, componentRegistry).get("w1") ?? 0;
    expect(insideBody(runY + shift, 0, relay.visual.height)).toBe(false);
  });

  it("同じ部品を避ける配線どうしは、避けたあとも離れている", () => {
    /*
     * 3 台のランプから電源の 0V へ引き戻す。走行は 3 本とも 0V の高さに立ち、
     * 途中のランプ本体を横切る。避けたあとに全部が本体のすぐ外へ寄ると、
     * せっかく解いた重なりが戻ってしまう。
     */
    const document: CircuitDocument = {
      version: 1,
      components: [
        { id: "ps", definitionId: "power-dc24v", position: { x: 0, y: 300 } },
        { id: "l1", definitionId: "lamp-dc24v", position: { x: 700, y: 0 } },
        { id: "l2", definitionId: "lamp-dc24v", position: { x: 700, y: 300 } },
        { id: "l3", definitionId: "lamp-dc24v", position: { x: 700, y: 600 } },
      ],
      connections: [
        wire("w1", ["l1", "2"], ["ps", "zero"]),
        wire("w2", ["l2", "2"], ["ps", "zero"]),
        wire("w3", ["l3", "2"], ["ps", "zero"]),
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    const lanes = buildWireLanes(document, componentRegistry);
    const shifts = [
      lanes.get("w1") ?? 0,
      lanes.get("w2") ?? 0,
      lanes.get("w3") ?? 0,
    ];
    // 3 本とも別の高さに立っている
    expect(new Set(shifts).size).toBe(3);

    const lamp = componentRegistry.get("lamp-dc24v")!;
    const power = componentRegistry.get("power-dc24v")!;
    const zero = power.terminals.find((t) => t.id === "zero")!;
    const runY = 300 + zero.position.y * power.visual.height;
    for (const shift of shifts) {
      // どれも l2（y 300〜460）の本体を横切らない
      expect(insideBody(runY + shift, 300, 300 + lamp.visual.height)).toBe(
        false,
      );
    }
  });

  it("回り込む幅が足りなければ諦める（無理に引き回さない）", () => {
    /*
     * 中点を動かす形の幹線は、両端の間から出ると経路が折り返す。
     * 部品が邪魔でも動かせる幅が無ければ、跨いだままにする —— 折り返した線は
     * 跨いでいる線より読みにくい。
     */
    const document: CircuitDocument = {
      version: 1,
      components: [
        { id: "ps", definitionId: "power-dc24v", position: { x: 0, y: 0 } },
        { id: "l1", definitionId: "lamp-dc24v", position: { x: 190, y: 0 } },
      ],
      connections: [wire("w1", ["ps", "plus"], ["l1", "1"])],
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    // 動いても動かなくても構わないが、破綻した値（部品幅を超える迂回）は返さない
    const shift = buildWireLanes(document, componentRegistry).get("w1") ?? 0;
    expect(Math.abs(shift)).toBeLessThanOrEqual(200);
  });
});
