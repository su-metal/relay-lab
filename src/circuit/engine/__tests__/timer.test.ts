/**
 * タイマー（限時動作・限時復帰）の検証（design.md §5.13）。
 *
 * **時刻はすべて明示する。** `simulate()` は `nowMs` を入力として受け取る
 * 純粋関数なので、実時間を待つ必要が無く、設定時間の 1ms 手前と丁度という
 * 境界を正確に突ける。ここが `performance.now()` を読む実装だったら、
 * このファイルは書けない（CLAUDE.md 設計原則 1）。
 */

import { describe, expect, it } from "vitest";

import { buildCurrentFlow } from "@/circuit/adapter/current-flow";
import { explainLoadPath } from "@/circuit/adapter/load-path";
import { buildSimulationView } from "@/circuit/adapter/simulation-view";
import { componentRegistry } from "@/circuit/definitions";
import { coilEnergized, simulate } from "@/circuit/engine";
import type {
  CircuitComponentInstance,
  CircuitConnection,
  CircuitDocument,
  SimulationResult,
} from "@/circuit/types";

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
  components: Record<string, string | CircuitComponentInstance>,
  connections: CircuitConnection[],
): CircuitDocument => ({
  version: 1,
  components: Object.entries(components).map(([id, entry]) =>
    typeof entry === "string"
      ? { id, definitionId: entry, label: id, position: { x: 0, y: 0 } }
      : entry,
  ),
  connections,
  viewport: { x: 0, y: 0, zoom: 1 },
});

/** 前回結果を引き継いで時刻だけ進める。**引き継がないと時間が進まない** */
const at = (
  document: CircuitDocument,
  nowMs: number,
  pressed: string[],
  previous?: SimulationResult,
): SimulationResult =>
  simulate(document, componentRegistry, {
    pressedSwitches: new Set(pressed),
    previousEnergizedRelays: previous?.energizedRelays,
    previousTimers: previous?.timers,
    nowMs,
  });

const POWER = "power-dc24v";
const PB_NO = "switch-pushbutton-no";
const ON_DELAY = "timer-on-delay";
const OFF_DELAY = "timer-off-delay";
const LAMP = "lamp-dc24v";

/** 押しボタン → タイマーのコイル、タイマーの a 接点 → ランプ */
const timerLamp = (definitionId: string, presetMs?: number): CircuitDocument =>
  circuit(
    {
      PS1: POWER,
      S1: PB_NO,
      T1: {
        id: "T1",
        definitionId,
        label: "T1",
        position: { x: 0, y: 0 },
        ...(presetMs === undefined ? {} : { presetMs }),
      },
      L1: LAMP,
    },
    [
      // 入力（コイル）
      wire("PS1:plus", "S1:1"),
      wire("S1:2", "T1:1"),
      wire("T1:2", "PS1:zero"),
      // 限時 a 接点の先にランプ
      wire("PS1:plus", "T1:3"),
      wire("T1:4", "L1:1"),
      wire("L1:2", "PS1:zero"),
    ],
  );

describe("オンディレイ（限時動作）", () => {
  const document = timerLamp(ON_DELAY); // 既定 3.0 秒

  it("押した瞬間はコイルだけ入り、接点はまだ動かない", () => {
    const idle = at(document, 0, []);
    const pressed = at(document, 0, ["S1"], idle);

    expect(pressed.status).toBe("stable");
    // コイルは入っている（＝計り始めた）
    expect(pressed.timers.get("T1")?.coilOn).toBe(true);
    // 接点はまだ。ランプは点かない
    expect(pressed.energizedRelays.has("T1")).toBe(false);
    expect([...pressed.litLamps]).toEqual([]);
  });

  it("設定時間の 1ms 手前では動かず、到達した瞬間に動く", () => {
    const idle = at(document, 0, []);
    const pressed = at(document, 0, ["S1"], idle);

    const justBefore = at(document, 2999, ["S1"], pressed);
    expect([...justBefore.litLamps]).toEqual([]);

    const justAt = at(document, 3000, ["S1"], justBefore);
    expect(justAt.energizedRelays.has("T1")).toBe(true);
    expect([...justAt.litLamps]).toEqual(["L1"]);
  });

  it("入力を切ると即座に戻る（限時なのは動作側だけ）", () => {
    const idle = at(document, 0, []);
    const pressed = at(document, 0, ["S1"], idle);
    const done = at(document, 3000, ["S1"], pressed);
    expect([...done.litLamps]).toEqual(["L1"]);

    const released = at(document, 3001, [], done);
    expect(released.energizedRelays.has("T1")).toBe(false);
    expect([...released.litLamps]).toEqual([]);
  });

  it("設定時間に届く前に離すと計り直しになる", () => {
    const idle = at(document, 0, []);
    const pressed = at(document, 0, ["S1"], idle);
    const released = at(document, 2000, [], pressed);
    // もう一度押す。ここから 3 秒であって、残り 1 秒ではない
    const again = at(document, 2000, ["S1"], released);

    expect([...at(document, 4999, ["S1"], again).litLamps]).toEqual([]);
    expect([...at(document, 5000, ["S1"], again).litLamps]).toEqual(["L1"]);
  });

  it("次に接点が変わる時刻を返し、動いた後は返さない", () => {
    const idle = at(document, 0, []);
    // 入力が無ければカウントしていない
    expect(idle.nextEventAtMs).toBeUndefined();

    const pressed = at(document, 500, ["S1"], idle);
    expect(pressed.nextEventAtMs).toBe(3500);

    // 動作したらもう待つものが無い。**ここを返し続けるとストアが時計を止められない**
    const done = at(document, 3500, ["S1"], pressed);
    expect(done.nextEventAtMs).toBeUndefined();
  });
});

describe("オフディレイ（限時復帰）", () => {
  const document = timerLamp(OFF_DELAY); // 既定 3.0 秒

  it("開始直後、一度も入力していないのに接点が動いてはいけない", () => {
    /*
     * `changedAtMs` を 0 で初期化すると「たった今入力が切れたところ」と
     * 読まれ、電源投入と同時にランプが点いてしまう（design.md §5.13）。
     */
    const idle = at(document, 0, []);

    expect(idle.energizedRelays.has("T1")).toBe(false);
    expect([...idle.litLamps]).toEqual([]);
    expect(idle.nextEventAtMs).toBeUndefined();
  });

  it("入力と同時に接点が動く", () => {
    const idle = at(document, 0, []);
    const pressed = at(document, 0, ["S1"], idle);

    expect(pressed.energizedRelays.has("T1")).toBe(true);
    expect([...pressed.litLamps]).toEqual(["L1"]);
  });

  it("入力を切ってから設定時間だけ保ち、到達した瞬間に戻る", () => {
    const idle = at(document, 0, []);
    const pressed = at(document, 0, ["S1"], idle);
    const released = at(document, 1000, [], pressed);

    // 離した直後もまだ保っている
    expect([...released.litLamps]).toEqual(["L1"]);
    expect(released.nextEventAtMs).toBe(4000);

    expect([...at(document, 3999, [], released).litLamps]).toEqual(["L1"]);
    expect([...at(document, 4000, [], released).litLamps]).toEqual([]);
  });

  it("保持中に再投入すると、切ったときから計り直す", () => {
    const idle = at(document, 0, []);
    const pressed = at(document, 0, ["S1"], idle);
    const released = at(document, 1000, [], pressed);
    const again = at(document, 2000, ["S1"], released);
    const releasedAgain = at(document, 2500, [], again);

    // 1 回目の 4000 では戻らない。2 回目に切った 2500 から 3 秒
    expect([...at(document, 4000, [], releasedAgain).litLamps]).toEqual(["L1"]);
    expect([...at(document, 5500, [], releasedAgain).litLamps]).toEqual([]);
  });
});

describe("設定時間はインスタンスごとに持つ", () => {
  it("presetMs を指定するとその時間で動く", () => {
    const document = timerLamp(ON_DELAY, 500);
    const idle = at(document, 0, []);
    const pressed = at(document, 0, ["S1"], idle);

    expect([...at(document, 499, ["S1"], pressed).litLamps]).toEqual([]);
    expect([...at(document, 500, ["S1"], pressed).litLamps]).toEqual(["L1"]);
  });

  it("範囲外の値は定義の上下限へ丸める（部品ごと捨てない）", () => {
    // 下限は 100ms。0 を指定しても即動作にはならない
    const document = timerLamp(ON_DELAY, 0);
    const idle = at(document, 0, []);
    const pressed = at(document, 0, ["S1"], idle);

    expect([...at(document, 99, ["S1"], pressed).litLamps]).toEqual([]);
    expect([...at(document, 100, ["S1"], pressed).litLamps]).toEqual(["L1"]);
  });

  it("同じ型番を違う設定時間で並べられる", () => {
    const document = circuit(
      {
        PS1: POWER,
        S1: PB_NO,
        T1: {
          id: "T1",
          definitionId: ON_DELAY,
          label: "T1",
          position: { x: 0, y: 0 },
          presetMs: 1000,
        },
        T2: {
          id: "T2",
          definitionId: ON_DELAY,
          label: "T2",
          position: { x: 0, y: 0 },
          presetMs: 2000,
        },
      },
      [
        wire("PS1:plus", "S1:1"),
        wire("S1:2", "T1:1"),
        wire("T1:2", "PS1:zero"),
        wire("S1:2", "T2:1"),
        wire("T2:2", "PS1:zero"),
      ],
    );
    const idle = at(document, 0, []);
    const pressed = at(document, 0, ["S1"], idle);

    const mid = at(document, 1000, ["S1"], pressed);
    expect(mid.energizedRelays.has("T1")).toBe(true);
    expect(mid.energizedRelays.has("T2")).toBe(false);
    // 先に上がる方が次のイベント時刻を決める
    expect(pressed.nextEventAtMs).toBe(1000);

    const later = at(document, 2000, ["S1"], mid);
    expect(later.energizedRelays.has("T2")).toBe(true);
  });
});

describe("タイマーはリレーとして振る舞う", () => {
  it("タイマーの接点で自己保持を組める", () => {
    /*
     * 押しボタンでタイマーのコイルを入れ、タイマー自身の a 接点で
     * コイルを保持する。オンディレイなので**設定時間に達するまでは
     * 保持が成立しない** —— 途中で離すと落ちる。
     */
    const document = circuit(
      {
        PS1: POWER,
        S1: PB_NO,
        T1: {
          id: "T1",
          definitionId: ON_DELAY,
          label: "T1",
          position: { x: 0, y: 0 },
          presetMs: 1000,
        },
      },
      [
        wire("PS1:plus", "S1:1"),
        wire("S1:2", "T1:1"),
        wire("PS1:plus", "T1:3"),
        wire("T1:4", "T1:1"),
        wire("T1:2", "PS1:zero"),
      ],
    );

    const idle = at(document, 0, []);
    const pressed = at(document, 0, ["S1"], idle);
    const held = at(document, 1000, ["S1"], pressed);
    expect(held.status).toBe("stable");
    expect(held.energizedRelays.has("T1")).toBe(true);

    // 離しても自分の接点がコイルを支える
    const released = at(document, 1001, [], held);
    expect(released.status).toBe("stable");
    expect(released.energizedRelays.has("T1")).toBe(true);
  });

  it("コイルの極性なし・未接続端子など、リレー用の判定がそのまま効く", () => {
    const document = timerLamp(ON_DELAY);
    const result = at(document, 0, []);

    // 端子 5（限時 b 接点）は配線していないので未接続として出る
    expect(
      result.warnings.some(
        (w) => w.code === "unconnected-terminal" && w.componentId === "T1",
      ),
    ).toBe(true);
    // 極性なしのコイルなので逆極性の警告は出ない
    expect(
      result.warnings.some((w) => w.code === "coil-polarity-reversed"),
    ).toBe(false);
  });
});

describe("時刻とタイマー状態の引き継ぎ", () => {
  it("previousTimers を渡さないと時間が進まない", () => {
    /*
     * 渡し忘れると毎回「今この瞬間に入力が入った」ところからやり直すので、
     * どれだけ時刻を進めても設定時間に到達しない。
     * `previousEnergizedRelays` と同じ性質の落とし穴（design.md §3.4）。
     */
    const document = timerLamp(ON_DELAY);
    const withoutHistory = simulate(document, componentRegistry, {
      pressedSwitches: new Set(["S1"]),
      nowMs: 999_999,
    });

    expect([...withoutHistory.litLamps]).toEqual([]);
  });

  it("タイマーが 1 個も無い回路では nextEventAtMs を返さない", () => {
    const document = circuit({ PS1: POWER, S1: PB_NO, L1: LAMP }, [
      wire("PS1:plus", "S1:1"),
      wire("S1:2", "L1:1"),
      wire("L1:2", "PS1:zero"),
    ]);

    expect(at(document, 0, ["S1"]).nextEventAtMs).toBeUndefined();
  });
});

describe("コイルと接点を取り違えない（design.md §5.13）", () => {
  const document = timerLamp(ON_DELAY, 1000);

  it("計測中はコイルが通電、接点はまだ動いていない", () => {
    const idle = at(document, 0, []);
    const counting = at(document, 500, ["S1"], idle);

    // コイルは入っている（これが「今まさに計っている」の根拠）
    expect(coilEnergized(counting, "T1", componentRegistry.get(ON_DELAY)!.electrical)).toBe(true);
    // 接点はまだ動いていない
    expect(counting.energizedRelays.has("T1")).toBe(false);
  });

  it("計測中のコイル配線は通電色になり、電流の向きも出る", () => {
    /*
     * `energizedRelays`（接点）だけを見ていると、**計り始めた瞬間に
     * コイルの配線が灰色になる。** 一番読みたい所が消えることになる。
     */
    const idle = at(document, 0, []);
    const counting = at(document, 500, ["S1"], idle);

    const view = buildSimulationView(
      document,
      componentRegistry,
      counting,
      new Set(["S1"]),
      undefined,
      500,
    );
    expect(view.terminalOf.get("T1:1")).toBe("energized");

    const flow = buildCurrentFlow(
      document,
      componentRegistry,
      counting,
      new Set(["S1"]),
    );
    expect(flow.directionOf.get("S1:2-T1:1")).toBe("forward");
  });

  it("残り時間が表示され、動作すると消える", () => {
    const idle = at(document, 0, []);
    // 0 で押し、400 の時点で見る。設定 1000 なので残り 600
    const pressed = at(document, 0, ["S1"], idle);
    const counting = at(document, 400, ["S1"], pressed);

    const viewOf = (result: SimulationResult, nowMs: number) =>
      buildSimulationView(
        document,
        componentRegistry,
        result,
        new Set(["S1"]),
        undefined,
        nowMs,
      ).deviceOf.get("T1")?.timer;

    expect(viewOf(counting, 400)?.remainingMs).toBe(600);
    expect(viewOf(counting, 400)?.coilOn).toBe(true);

    const done = at(document, 1000, ["S1"], counting);
    expect(viewOf(done, 1000)?.remainingMs).toBeUndefined();
  });

  it("計測中の経路説明は「通電している」側で答える", () => {
    /*
     * ここを接点で判定すると、計測中のタイマーが「通電していません」の側へ
     * 落ち、届いているはずの電源を探し始める。
     */
    const idle = at(document, 0, []);
    const counting = at(document, 500, ["S1"], idle);

    const explanation = explainLoadPath(
      document,
      componentRegistry,
      counting,
      new Set(["S1"]),
      "T1",
      500,
    );
    expect(explanation?.active).toBe(true);
  });
});
