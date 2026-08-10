/**
 * 自己保持の検出の検証（design.md §5.9）。
 *
 * ここで守りたいのは 3 つ。
 *
 * 1. **押している間は自己保持ではない。** 保持しているのはボタンであって接点ではない
 * 2. **紫の線 ＝ 切ればリレーが落ちる線。** 凡例の約束（「ここを切ると落ちます」）を
 *    実際に配線を 1 本ずつ切って確かめる
 * 3. **接点がコイルのどちら側にあっても同じ答えになる。** + 側に自己保持接点を置く
 *    書き方と、− 側（0V 側）に置く書き方の両方で成り立つこと
 *
 * UI を起動せず、実端子番号（MY4N / MY2N のコイル 13/14・第1接点 NC=1 / NO=5 / COM=9）で
 * 回路を組んで検証する。
 */

import { describe, expect, it } from "vitest";

import { buildSelfHold } from "@/circuit/adapter/self-hold";
import { buildSimulationView } from "@/circuit/adapter/simulation-view";
import { componentRegistry } from "@/circuit/definitions";
import { simulate } from "@/circuit/engine";
import type {
  CircuitConnection,
  CircuitDocument,
  SimulationResult,
} from "@/circuit/types";

/** "RY1:14" のような "インスタンスID:端子ID" 記法で配線する */
const wire = (from: string, to: string): CircuitConnection => {
  const [fromComponent, fromTerminal] = from.split(":");
  const [toComponent, toTerminal] = to.split(":");
  return {
    id: `${from}-${to}`,
    from: { componentId: fromComponent, terminalId: fromTerminal },
    to: { componentId: toComponent, terminalId: toTerminal },
  };
};

const circuit = (
  components: Record<string, string>,
  connections: CircuitConnection[],
): CircuitDocument => ({
  version: 1,
  components: Object.entries(components).map(([id, definitionId]) => ({
    id,
    definitionId,
    label: id,
    position: { x: 0, y: 0 },
  })),
  connections,
  viewport: { x: 0, y: 0, zoom: 1 },
});

const POWER = "power-dc24v";
const PB_NO = "switch-pushbutton-no";
const PB_NC = "switch-pushbutton-nc";
const MY4N = "omron-my4n-dc24";
const MY2N = "omron-my2n-dc24";

const PARTS = { PS1: POWER, S1: PB_NO, S2: PB_NC, RY1: MY4N };

/**
 * 停止付き自己保持回路 —— 自己保持接点が**コイルの + 側**にある書き方
 * （`engine/__tests__/scenarios.test.ts` の検証回路テスト4 と同じ配線）。
 */
const plusSideLinks = [
  // +24V → S2(B接点) → 起動系統
  wire("PS1:plus", "S2:1"),
  wire("S2:2", "S1:1"),
  wire("S2:2", "RY1:9"),
  wire("S1:2", "RY1:14"),
  // 自己保持接点。COM(9) の先の NO(5) をコイル 14 へ戻す
  wire("RY1:5", "RY1:14"),
  wire("RY1:13", "PS1:zero"),
];

const document = circuit(PARTS, plusSideLinks);

/**
 * 同じ動作を**コイルの − 側**で組んだ書き方。
 *
 * コイル + を +24V へ直結し、コイル − から COM(9) → NO(5) → 停止ボタン → 0V で
 * 帰す。起動ボタンはコイル − から 0V への別ルートとして並列に入る。
 * 画面上で自己保持を組むとこちらの形になることが多い。
 */
const minusSideParts = { PS1: POWER, TRIG: PB_NO, RESET: PB_NC, RY1: MY2N };
const minusSideLinks = [
  wire("PS1:plus", "RY1:14"),
  wire("RY1:13", "TRIG:1"),
  wire("TRIG:2", "PS1:zero"),
  wire("RY1:13", "RY1:9"),
  wire("RY1:5", "RESET:2"),
  wire("RESET:1", "PS1:zero"),
];
const minusSideDocument = circuit(minusSideParts, minusSideLinks);

/** 1 手進めて、その状態の結果と自己保持を返す */
const stepOn = (
  doc: CircuitDocument,
  pressed: string[],
  previous?: SimulationResult,
) => {
  const pressedSwitches = new Set(pressed);
  const result = simulate(doc, componentRegistry, {
    pressedSwitches,
    previousEnergizedRelays: previous?.energizedRelays,
  });
  return {
    result,
    selfHold: buildSelfHold(doc, componentRegistry, result, pressedSwitches),
    pressedSwitches,
  };
};

const step = (pressed: string[], previous?: SimulationResult) =>
  stepOn(document, pressed, previous);

/** 起動ボタンを押して離した「自己保持中」の状態まで進める */
const heldOn = (doc: CircuitDocument, startButton: string) => {
  const idle = stepOn(doc, []);
  const pressed = stepOn(doc, [startButton], idle.result);
  return stepOn(doc, [], pressed.result);
};

describe("buildSelfHold", () => {
  it("停止中（result が null）は空を返す", () => {
    const selfHold = buildSelfHold(
      document,
      componentRegistry,
      null,
      new Set(),
    );
    expect(selfHold.relays.size).toBe(0);
    expect(selfHold.terminals.size).toBe(0);
    expect(selfHold.connections.size).toBe(0);
  });

  it("非励磁のときは何も自己保持していない", () => {
    const { result, selfHold } = step([]);
    expect(result.energizedRelays.size).toBe(0);
    expect(selfHold.relays.size).toBe(0);
  });

  it("起動ボタンを押している間は自己保持ではない（保持しているのはボタン）", () => {
    const pressed = step(["S1"], step([]).result);
    expect([...pressed.result.energizedRelays]).toEqual(["RY1"]);
    expect([...pressed.selfHold.relays]).toEqual([]);
    expect(pressed.selfHold.terminals.size).toBe(0);
    expect(pressed.selfHold.connections.size).toBe(0);
  });

  it("ボタンを離すと自己保持になる", () => {
    const released = heldOn(document, "S1");

    expect([...released.result.energizedRelays]).toEqual(["RY1"]);
    expect([...released.selfHold.relays]).toEqual(["RY1"]);
  });

  it("保持経路は電源からコイルを回って電源へ戻る一周", () => {
    const { selfHold } = heldOn(document, "S1");

    // +24V → 停止ボタン → COM(9) → NO(5) → コイル + (14)
    expect([...selfHold.connections].sort()).toEqual(
      [
        "PS1:plus-S2:1",
        "S2:2-RY1:9",
        "RY1:5-RY1:14",
        // コイル − (13) → 0V。ここを切っても落ちるので保持経路の一部
        "RY1:13-PS1:zero",
      ].sort(),
    );

    // 接点の内側（COM 9 と NO 5）も経路上にある
    expect(selfHold.terminals.has("RY1:9")).toBe(true);
    expect(selfHold.terminals.has("RY1:5")).toBe(true);
    expect(selfHold.terminals.has("RY1:14")).toBe(true);
    expect(selfHold.terminals.has("RY1:13")).toBe(true);

    // 開いている起動ボタンへ伸びる枝は行き止まり。切っても落ちないので経路ではない
    expect(selfHold.connections.has("S2:2-S1:1")).toBe(false);
    expect(selfHold.connections.has("S1:2-RY1:14")).toBe(false);
    expect(selfHold.terminals.has("S1:1")).toBe(false);
    expect(selfHold.terminals.has("S1:2")).toBe(false);
  });

  it("コイルの − 側に自己保持接点を置いた回路でも、帰り道が経路になる", () => {
    const { result, selfHold } = heldOn(minusSideDocument, "TRIG");

    expect([...result.energizedRelays]).toEqual(["RY1"]);
    expect([...selfHold.relays]).toEqual(["RY1"]);
    expect([...selfHold.connections].sort()).toEqual(
      [
        "PS1:plus-RY1:14",
        "RY1:13-RY1:9",
        // コイル − → COM(9) → NO(5) → 停止ボタン → 0V が保持の本体
        "RY1:5-RESET:2",
        "RESET:1-PS1:zero",
      ].sort(),
    );

    // 開いている起動ボタンの側は 0V へ届いていても保持していない
    expect(selfHold.connections.has("RY1:13-TRIG:1")).toBe(false);
    expect(selfHold.connections.has("TRIG:2-PS1:zero")).toBe(false);
  });

  it("停止ボタンを押している間は自己保持が消える（消磁するので当然）", () => {
    const released = heldOn(document, "S1");
    const stopped = step(["S2"], released.result);

    expect([...stopped.result.energizedRelays]).toEqual([]);
    expect([...stopped.selfHold.relays]).toEqual([]);
  });

  it("自己保持接点を持たないリレーは、励磁していても自己保持にならない", () => {
    const direct = circuit({ PS1: POWER, S1: PB_NO, RY1: MY4N }, [
      wire("PS1:plus", "S1:1"),
      wire("S1:2", "RY1:14"),
      wire("RY1:13", "PS1:zero"),
    ]);
    const pressedSwitches = new Set(["S1"]);
    const result = simulate(direct, componentRegistry, { pressedSwitches });

    expect([...result.energizedRelays]).toEqual(["RY1"]);
    expect(
      buildSelfHold(direct, componentRegistry, result, pressedSwitches).relays
        .size,
    ).toBe(0);
  });
});

/**
 * 凡例の約束（「ここを切ると落ちます」）そのものの検証。
 *
 * 配線を 1 本ずつ抜いた回路を作り、自己保持中の励磁集合から解き直して
 * 落ちるかどうかを見る。**これが紫の定義**であり、実装（橋の判定）とは
 * まったく別の道具（`simulate()` の再実行）で答えを出しているので、
 * 近似が入り込めば必ずここで落ちる。
 */
describe("紫の線 ＝ 切るとリレーが落ちる線", () => {
  const dropsWhenCut = (
    parts: Record<string, string>,
    links: readonly CircuitConnection[],
    held: SimulationResult,
    cut: CircuitConnection,
  ): boolean => {
    const damaged = circuit(
      parts,
      links.filter((link) => link.id !== cut.id),
    );
    const after = simulate(damaged, componentRegistry, {
      pressedSwitches: new Set(),
      previousEnergizedRelays: held.energizedRelays,
    });
    return !after.energizedRelays.has("RY1");
  };

  it.each([
    ["+ 側に接点", document, PARTS, plusSideLinks, "S1"],
    ["− 側に接点", minusSideDocument, minusSideParts, minusSideLinks, "TRIG"],
  ] as const)("%s の回路で一致する", (_name, doc, parts, links, start) => {
    const { result, selfHold } = heldOn(doc, start);

    const painted = links
      .filter((link) => selfHold.connections.has(link.id))
      .map((link) => link.id)
      .sort();
    const critical = links
      .filter((link) => dropsWhenCut(parts, links, result, link))
      .map((link) => link.id)
      .sort();

    expect(painted).toEqual(critical);
    // 「1 本も塗らない」で一致してしまうと検証にならない
    expect(painted.length).toBeGreaterThan(0);
  });
});

describe("自己保持の配線色（buildSimulationView との統合）", () => {
  it("保持ループの配線と端子が self-hold になる", () => {
    const released = heldOn(document, "S1");
    const view = buildSimulationView(
      document,
      componentRegistry,
      released.result,
      released.pressedSwitches,
      released.selfHold,
    );

    // 自己保持接点 NO(5) → コイル 14 の線が紫
    expect(view.wireOf.get("RY1:5-RY1:14")).toBe("self-hold");
    // 電源から接点 COM(9) までの幹線も、切れば落ちるので同じ紫
    expect(view.wireOf.get("S2:2-RY1:9")).toBe("self-hold");
    expect(view.wireOf.get("PS1:plus-S2:1")).toBe("self-hold");
    expect(view.wireOf.get("RY1:13-PS1:zero")).toBe("self-hold");

    // 開いた起動ボタンへの枝は通電中のまま（切っても落ちない）
    expect(view.wireOf.get("S2:2-S1:1")).toBe("energized");
    expect(view.wireOf.get("S1:2-RY1:14")).toBe("energized");

    expect(view.terminalOf.get("RY1:5")).toBe("self-hold");
    expect(view.terminalOf.get("RY1:9")).toBe("self-hold");
    expect(view.deviceOf.get("RY1")?.selfHeld).toBe(true);
  });

  it("同じ端子から出ていても、行き止まりの線は紫にならない", () => {
    const released = heldOn(minusSideDocument, "TRIG");
    const view = buildSimulationView(
      minusSideDocument,
      componentRegistry,
      released.result,
      released.pressedSwitches,
      released.selfHold,
    );

    // どちらもコイル −(13) から出ている 2 本。保持しているのは接点側だけ
    expect(view.wireOf.get("RY1:13-RY1:9")).toBe("self-hold");
    expect(view.wireOf.get("RY1:13-TRIG:1")).toBe("energized");
    expect(view.terminalOf.get("RY1:13")).toBe("self-hold");
  });

  it("押している間は緑のまま（色が変わるのは離した瞬間）", () => {
    const pressed = step(["S1"], step([]).result);
    const view = buildSimulationView(
      document,
      componentRegistry,
      pressed.result,
      pressed.pressedSwitches,
      pressed.selfHold,
    );

    expect(view.wireOf.get("RY1:5-RY1:14")).toBe("energized");
    expect(view.deviceOf.get("RY1")?.selfHeld).toBe(false);
  });
});
