/**
 * フェード（時間をかけた明るさの変化）の検証（design.md §5.18）。
 *
 * **時刻はすべて明示する。** `timer.test.ts` とまったく同じ理由で、
 * エンジンが `performance.now()` を読まないからこのファイルが書ける
 * （CLAUDE.md 設計原則 1）。フェード時間の丁度と 1ms 手前を実時間を待たずに突く。
 *
 * 押さえどころは 2 つ。
 *
 * 1. **途中で目標が変わっても電圧が飛ばないこと**（`fromVolts` の取り方）
 * 2. **到達したら `fadeNextEventAtMs` が黙ること**（ストアが時計を止められる）
 */

import { describe, expect, it } from "vitest";

import { buildSimulationView } from "@/circuit/adapter/simulation-view";
import { componentRegistry } from "@/circuit/definitions";
import {
  advanceFade,
  fadeMsOf,
  fadeNextEventAtMs,
  fadeVoltsOf,
  initialFadeState,
  simulate,
} from "@/circuit/engine";
import type {
  CircuitComponentInstance,
  CircuitConnection,
  CircuitDocument,
  FadeState,
  FadeSpec,
  SimulationResult,
} from "@/circuit/types";
import { fadeKey } from "@/circuit/types";

const FADE: FadeSpec = { minFadeMs: 0, maxFadeMs: 60_000, defaultFadeMs: 0 };

describe("初期状態", () => {
  it("開始時は目標値そのもの。0V から這い上がらない", () => {
    // 実機のコントローラは電源が入った時点で設定値を出している。
    // ここを 0 から始めると ▶ を押すたびに全回路が下から上がってくる
    const state = initialFadeState(7);
    expect(state.targetVolts).toBe(7);
    expect(state.fromVolts).toBe(7);
    expect(state.changedAtMs).toBeNull();
    expect(fadeVoltsOf(state, 3_000, 0)).toBe(7);
    expect(fadeVoltsOf(state, 3_000, 99_999)).toBe(7);
  });

  it("`changedAtMs` は null。0 で初期化しない", () => {
    // 0 だと「たった今この値になった」と読まれ、開始直後の 1 回目の
    // 解き直しでフェードが走り出す（`TimerState` とまったく同じ落とし穴）
    expect(advanceFade(undefined, 4, 3_000, 5_000).changedAtMs).toBeNull();
  });

  it("初回は前回が無いので目標へ即座に着く", () => {
    const state = advanceFade(undefined, 4, 3_000, 5_000);
    expect(fadeVoltsOf(state, 3_000, 5_000)).toBe(4);
  });
});

describe("目標が変わったときだけ打ち直す", () => {
  it("同じ目標なら状態はそのまま（同一参照）", () => {
    // 毎回 nowMs を書き込むと経過時間が常に 0 になり、いつまでも動かない
    const first = advanceFade(undefined, 3, 3_000, 0);
    const second = advanceFade(first, 3, 3_000, 1_000);
    expect(second).toBe(first);
  });

  it("目標が変わったら今の時刻から数え始める", () => {
    const first = advanceFade(undefined, 3, 3_000, 0);
    const next = advanceFade(first, 8, 3_000, 1_000);
    expect(next).toEqual({ targetVolts: 8, fromVolts: 3, changedAtMs: 1_000 });
  });
});

describe("1 次補間", () => {
  const ramping = (): FadeState =>
    advanceFade(advanceFade(undefined, 3, 3_000, 0), 8, 3_000, 1_000);

  it("開始直後は開始値、丁度で目標値", () => {
    const state = ramping();
    expect(fadeVoltsOf(state, 3_000, 1_000)).toBe(3);
    expect(fadeVoltsOf(state, 3_000, 4_000)).toBe(8);
  });

  it("半分の時刻で半分の電圧", () => {
    // 3V → 8V の中点は 5.5V
    expect(fadeVoltsOf(ramping(), 3_000, 2_500)).toBeCloseTo(5.5, 10);
  });

  it("丁度の 1ms 手前はまだ目標へ届いていない", () => {
    expect(fadeVoltsOf(ramping(), 3_000, 3_999)).toBeLessThan(8);
    expect(fadeVoltsOf(ramping(), 3_000, 4_000)).toBe(8);
  });

  it("行き過ぎた時刻でも目標を越えない（外挿しない）", () => {
    expect(fadeVoltsOf(ramping(), 3_000, 100_000)).toBe(8);
  });

  it("下げ方向も同じ 1 本で出る", () => {
    // 上げ下げでフェード時間を分けていないので、式も 1 本のまま
    const state = advanceFade(advanceFade(undefined, 10, 2_000, 0), 0, 2_000, 500);
    expect(fadeVoltsOf(state, 2_000, 1_500)).toBeCloseTo(5, 10);
    expect(fadeVoltsOf(state, 2_000, 2_500)).toBe(0);
  });
});

describe("フェードの途中で目標を変えても飛ばない", () => {
  it("打ち直しの開始値は「前の目標」ではなく「今の実効電圧」", () => {
    // 3V → 8V の途中（中点 5.5V）で 2V へ変え直す。
    // ここで前の目標（3V）から始めたり、目標（8V）から落としたりすると
    // 画面の中で電圧が飛ぶ
    const ramping = advanceFade(
      advanceFade(undefined, 3, 3_000, 0),
      8,
      3_000,
      1_000,
    );
    const redirected = advanceFade(ramping, 2, 3_000, 2_500);

    expect(redirected.fromVolts).toBeCloseTo(5.5, 10);
    expect(redirected.changedAtMs).toBe(2_500);
    // 打ち直した瞬間は動く前と同じ電圧のまま（不連続が無い）
    expect(fadeVoltsOf(redirected, 3_000, 2_500)).toBeCloseTo(5.5, 10);
    expect(fadeVoltsOf(redirected, 3_000, 5_500)).toBe(2);
  });
});

describe("フェード時間 0（既定）", () => {
  it("常に目標値。割り算を通らない", () => {
    const state = advanceFade(advanceFade(undefined, 3, 0, 0), 8, 0, 1_000);
    expect(fadeVoltsOf(state, 0, 1_000)).toBe(8);
    expect(Number.isNaN(fadeVoltsOf(state, 0, 1_000))).toBe(false);
  });

  it("次の時刻も返さない。フェードを使わない回路で時計が回り続けない", () => {
    const state = advanceFade(advanceFade(undefined, 3, 0, 0), 8, 0, 1_000);
    expect(fadeNextEventAtMs(state, 0, 1_000)).toBeUndefined();
  });
});

describe("次に変わり終わる時刻", () => {
  const ramping = (): FadeState =>
    advanceFade(advanceFade(undefined, 3, 3_000, 0), 8, 3_000, 1_000);

  it("ランプ中は終わる時刻を返す", () => {
    expect(fadeNextEventAtMs(ramping(), 3_000, 1_000)).toBe(4_000);
    expect(fadeNextEventAtMs(ramping(), 3_000, 3_999)).toBe(4_000);
  });

  it("到達したら黙る。過去の時刻を返し続けない", () => {
    // 返し続けるとストアが時計を止められず、CPU を回し続ける
    expect(fadeNextEventAtMs(ramping(), 3_000, 4_000)).toBeUndefined();
    expect(fadeNextEventAtMs(ramping(), 3_000, 9_999)).toBeUndefined();
  });

  it("一度も目標が変わっていなければ黙る", () => {
    expect(fadeNextEventAtMs(initialFadeState(5), 3_000, 0)).toBeUndefined();
  });
});

describe("設定値の丸め", () => {
  it("省略時は定義の既定値", () => {
    expect(fadeMsOf(FADE, undefined)).toBe(0);
  });

  it("範囲外は上下限へ倒す。壊れた保存データでも部品ごと捨てない", () => {
    expect(fadeMsOf(FADE, -5_000)).toBe(0);
    expect(fadeMsOf(FADE, 999_999)).toBe(60_000);
    expect(fadeMsOf(FADE, Number.NaN)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// エンジンを通した振る舞い
// ---------------------------------------------------------------------------

const wire = (from: string, to: string): CircuitConnection => {
  const [fc, ft] = from.split(":");
  const [tc, tt] = to.split(":");
  return {
    id: `${from}-${to}`,
    from: { componentId: fc, terminalId: ft },
    to: { componentId: tc, terminalId: tt },
  };
};

const circuit = (
  components: CircuitComponentInstance[],
  connections: CircuitConnection[],
): CircuitDocument => ({
  version: 1,
  components,
  connections,
  viewport: { x: 0, y: 0, zoom: 1 },
});

const at = (x: number) => ({ x, y: 0 });

/** AC100V 電源 → 調光ランプ、調光出力 → ランプの調光入力（基準も繋ぐ） */
const dimmedLamp = (volts: number, fadeMs: number): CircuitDocument =>
  circuit(
    [
      { id: "PS", definitionId: "power-ac100v", label: "PS", position: at(0) },
      {
        id: "DIM",
        definitionId: "dimmer-0-10v",
        label: "DIM",
        position: at(1),
        channelVolts: { "1": volts },
        fadeMs,
      },
      {
        id: "L1",
        definitionId: "lamp-dimmable-ac100v",
        label: "L1",
        position: at(2),
      },
    ],
    [
      wire("PS:L", "L1:1"),
      wire("PS:N", "L1:2"),
      wire("DIM:V+", "L1:DIM+"),
      wire("DIM:COM", "L1:DIM-"),
    ],
  );

/** 前回の結果を引き継いで時刻だけ進める。ストアがやっていることと同じ */
const step = (
  document: CircuitDocument,
  previous: SimulationResult | undefined,
  nowMs: number,
): SimulationResult =>
  simulate(document, componentRegistry, {
    pressedSwitches: new Set(),
    previousEnergizedRelays: previous?.energizedRelays,
    previousTimers: previous?.timers,
    previousFades: previous?.fades,
    nowMs,
  });

const percentOf = (result: SimulationResult, id: string): number => {
  const level = result.analog.levelOf.get(id);
  if (!level) throw new Error(`${id} の調光レベルが無い`);
  return level.percent;
};

describe("エンジンを通したフェード", () => {
  it("フェードを設定していない回路の解は 1 ビットも変わらない", () => {
    // 既定は 0 秒。保存済みの回路を開いた瞬間に挙動が変わってはいけない
    const document = dimmedLamp(2, 0);
    const first = step(document, undefined, 0);
    const later = step(document, first, 10_000);

    expect(percentOf(first, "L1")).toBe(80);
    expect(percentOf(later, "L1")).toBe(80);
    expect(later.nextEventAtMs).toBeUndefined();
  });

  it("目標を変えると明るさが段階的に動く", () => {
    // 逆特性（0V = 100%）なので、電圧が上がると暗くなる
    const before = step(dimmedLamp(0, 4_000), undefined, 0);
    expect(percentOf(before, "L1")).toBe(100);

    const document = dimmedLamp(10, 4_000);
    const start = step(document, before, 1_000);
    const middle = step(document, start, 3_000);
    const end = step(document, middle, 5_000);

    expect(percentOf(start, "L1")).toBe(100);
    expect(percentOf(middle, "L1")).toBeCloseTo(50, 10);
    expect(percentOf(end, "L1")).toBe(0);
  });

  it("ランプ中だけ `nextEventAtMs` が立ち、着いたら消える", () => {
    // ストアが時計を回す条件そのもの。着いても返し続けると止まらない
    const before = step(dimmedLamp(0, 4_000), undefined, 0);
    const document = dimmedLamp(10, 4_000);

    const start = step(document, before, 1_000);
    expect(start.nextEventAtMs).toBe(5_000);

    const end = step(document, start, 5_000);
    expect(end.nextEventAtMs).toBeUndefined();
  });

  it("フェード中の電圧は配線（信号ネット）にも乗る", () => {
    // 端子には V、部品には %（design.md §5.17）。フェードでも同じ 1 つの値
    const before = step(dimmedLamp(0, 4_000), undefined, 0);
    const document = dimmedLamp(10, 4_000);
    const middle = step(document, step(document, before, 1_000), 3_000);

    const volts = [...middle.analog.signalOf.values()].map((s) => s.volts);
    expect(volts).toEqual([5]);
  });

  it("`previousFades` を渡し忘れると電圧が飛ぶ", () => {
    // `previousTimers` と同じ落とし穴。毎回「今この瞬間に到達した」から
    // やり直すので、フェードがまるごと効かなくなる
    const document = dimmedLamp(10, 4_000);
    const forgotten = simulate(document, componentRegistry, {
      pressedSwitches: new Set(),
      nowMs: 1_000,
    });
    expect(percentOf(forgotten, "L1")).toBe(0);
  });
});

describe("本体に出す電圧も途中の値になる（design.md §5.18）", () => {
  it("ノードの `channelVolts` は目標ではなく今出している電圧", () => {
    /*
     * ここが目標値のままだと、**本体の数字だけが設定した瞬間に飛び、
     * 繋がった配線と負荷だけが遅れて動く。** 同じ 1 本の信号が 2 つの値で
     * 見えることになり、フェードしているのかどうかが読めない
     */
    const before = step(dimmedLamp(0, 4_000), undefined, 0);
    const document = dimmedLamp(10, 4_000);
    const start = step(document, before, 1_000);
    const middle = step(document, start, 3_000);

    const view = buildSimulationView(
      document,
      componentRegistry,
      middle,
      new Set(),
      undefined,
      3_000,
    );
    expect(view.deviceOf.get("DIM")?.channelVolts?.[0]?.volts).toBe(5);
  });

  it("フェードを持たない回路では今までどおり目標値", () => {
    const document = dimmedLamp(2, 0);
    const result = step(document, undefined, 0);
    const view = buildSimulationView(
      document,
      componentRegistry,
      result,
      new Set(),
    );
    expect(view.deviceOf.get("DIM")?.channelVolts?.[0]?.volts).toBe(2);
  });
});

describe("接点で 0V へ落とす配線（DIRECT）はフェードしない", () => {
  it("接点が閉じた瞬間に 0V。機器の外の短絡は出力段を通らない", () => {
    const document = circuit(
      [
        { id: "PS", definitionId: "power-ac100v", label: "PS", position: at(0) },
        {
          id: "DIM",
          definitionId: "dimmer-0-10v",
          label: "DIM",
          position: at(1),
          channelVolts: { "1": 10 },
          fadeMs: 10_000,
        },
        {
          id: "L1",
          definitionId: "lamp-dimmable-ac100v",
          label: "L1",
          position: at(2),
        },
        {
          id: "S1",
          definitionId: "switch-pushbutton-no",
          label: "S1",
          position: at(3),
        },
      ],
      [
        wire("PS:L", "L1:1"),
        wire("PS:N", "L1:2"),
        wire("DIM:V+", "L1:DIM+"),
        wire("DIM:COM", "L1:DIM-"),
        // 信号線を押しボタン経由でコモンへ落とす（実機盤の "DIRECT"）
        wire("DIM:V+", "S1:1"),
        wire("S1:2", "DIM:COM"),
      ],
    );

    const off = simulate(document, componentRegistry, {
      pressedSwitches: new Set(),
      nowMs: 0,
    });
    expect(percentOf(off, "L1")).toBe(0);

    // 押した瞬間（時刻は 1ms しか進んでいない）に全灯。10 秒かけない
    const on = simulate(document, componentRegistry, {
      pressedSwitches: new Set(["S1"]),
      previousFades: off.fades,
      nowMs: 1,
    });
    expect(percentOf(on, "L1")).toBe(100);
  });
});

describe("フェード中に接点が動く（カットリレー）", () => {
  it("動作点をまたいだ時刻でカットリレーが入る", () => {
    /*
     * 調光コントローラ → ライトコントローラの調光入力。
     * カットリレー接点で DC24V の表示灯を点ける（実機の「絞ったら落ちる」）。
     *
     * 明るさが動作点（既定 25%）**以下**で動作する。逆特性なので
     * 電圧を上げるほど暗くなり、7.5V で丁度 25% に届く。
     */
    const controller = (volts: number): CircuitComponentInstance => ({
      id: "DIMC",
      definitionId: "dimming-controller-16ch",
      label: "DIMC",
      position: at(0),
      channelVolts: { "1": volts },
      fadeMs: 4_000,
    });

    const build = (volts: number): CircuitDocument =>
      circuit(
        [
          controller(volts),
          {
            id: "LC",
            definitionId: "light-controller-4ch",
            label: "LC",
            position: at(1),
          },
          {
            id: "PS2",
            definitionId: "power-dc24v",
            label: "PS2",
            position: at(2),
          },
          {
            id: "L2",
            definitionId: "lamp-dc24v",
            label: "L2",
            position: at(3),
          },
        ],
        [
          wire("DIMC:1", "LC:IN1"),
          wire("DIMC:21", "LC:ING"),
          wire("PS2:plus", "LC:CRG"),
          wire("LC:CR1", "L2:1"),
          wire("L2:2", "PS2:zero"),
        ],
      );

    // 0V（全灯）から始めて 10V（消灯）へ 4 秒かけて振る
    const before = step(build(0), undefined, 0);
    expect(before.litLamps.has("L2")).toBe(false);

    const document = build(10);
    const start = step(document, before, 1_000);
    // 2 秒経過＝5V＝50%。まだ動作点 25% には落ちていない
    const half = step(document, start, 3_000);
    // 3 秒経過＝7.5V＝25%。ここで丁度またぐ
    const cross = step(document, half, 4_000);

    expect(start.litLamps.has("L2")).toBe(false);
    expect(half.litLamps.has("L2")).toBe(false);
    expect(cross.litLamps.has("L2")).toBe(true);
    expect(cross.operatedContacts.get("LC")?.has("c1")).toBe(true);
  });
});

describe("`fadeKey` の形", () => {
  it("チャンネルごとに別の状態を持つ", () => {
    // フェード時間は機器で 1 つだが、どこまで動いたかは回路ごとに違う
    const document = circuit(
      [
        {
          id: "DIMC",
          definitionId: "dimming-controller-16ch",
          label: "DIMC",
          position: at(0),
          channelVolts: { "1": 3, "2": 7 },
          fadeMs: 2_000,
        },
      ],
      [],
    );
    const result = step(document, undefined, 0);
    expect(result.fades.get(fadeKey("DIMC", "1"))?.targetVolts).toBe(3);
    expect(result.fades.get(fadeKey("DIMC", "2"))?.targetVolts).toBe(7);
  });
});
