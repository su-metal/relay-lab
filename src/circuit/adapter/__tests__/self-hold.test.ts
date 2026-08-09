/**
 * 自己保持の検出の検証（design.md §5.9）。
 *
 * ここで守りたいのは 2 つ。
 *
 * 1. **押している間は自己保持ではない。** 保持しているのはボタンであって接点ではない
 * 2. **保持経路は「切れば落ちる枝」だけ。** 電源からの幹線を含めない
 *
 * UI を起動せず、実端子番号（MY4N のコイル 13/14・第1接点 NC=1 / NO=5 / COM=9）で
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

/** 停止付き自己保持回路（`engine/__tests__/scenarios.test.ts` の検証回路テスト4 と同じ配線） */
const document = circuit({ PS1: POWER, S1: PB_NO, S2: PB_NC, RY1: MY4N }, [
  // +24V → S2(B接点) → 起動系統
  wire("PS1:plus", "S2:1"),
  wire("S2:2", "S1:1"),
  wire("S2:2", "RY1:9"),
  wire("S1:2", "RY1:14"),
  // 自己保持接点。COM(9) の先の NO(5) をコイル 14 へ戻す
  wire("RY1:5", "RY1:14"),
  wire("RY1:13", "PS1:zero"),
]);

/** 1 手進めて、その状態の結果と自己保持を返す */
const step = (pressed: string[], previous?: SimulationResult) => {
  const pressedSwitches = new Set(pressed);
  const result = simulate(document, componentRegistry, {
    pressedSwitches,
    previousEnergizedRelays: previous?.energizedRelays,
  });
  return {
    result,
    selfHold: buildSelfHold(document, componentRegistry, result, pressedSwitches),
    pressedSwitches,
  };
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
  });

  it("ボタンを離すと自己保持になる", () => {
    const idle = step([]);
    const pressed = step(["S1"], idle.result);
    const released = step([], pressed.result);

    expect([...released.result.energizedRelays]).toEqual(["RY1"]);
    expect([...released.selfHold.relays]).toEqual(["RY1"]);
  });

  it("保持経路は接点の先の枝だけ（電源からの幹線は含めない）", () => {
    const released = step([], step(["S1"], step([]).result).result);
    const { terminals } = released.selfHold;

    // 自己保持接点の NO(5) とコイル +(14)、その間の線に載る端子が保持経路
    expect(terminals.has("RY1:5")).toBe(true);
    expect(terminals.has("RY1:14")).toBe(true);
    expect(terminals.has("S1:2")).toBe(true);

    // COM(9) は接点が開いても +24V に届いたままなので保持経路ではない。
    // ここまで塗ると「切ればリレーが落ちる線」がぼやける
    expect(terminals.has("RY1:9")).toBe(false);
    expect(terminals.has("PS1:plus")).toBe(false);
    expect(terminals.has("S2:2")).toBe(false);
    // コイル −(13) 側は 0V に直結しており、接点を開いても変わらない
    expect(terminals.has("RY1:13")).toBe(false);
    expect(terminals.has("PS1:zero")).toBe(false);
  });

  it("停止ボタンを押している間は自己保持が消える（消磁するので当然）", () => {
    const released = step([], step(["S1"], step([]).result).result);
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

describe("自己保持の配線色（buildSimulationView との統合）", () => {
  it("保持経路の配線と端子が self-hold になり、幹線は energized のまま", () => {
    const released = step([], step(["S1"], step([]).result).result);
    const view = buildSimulationView(
      document,
      componentRegistry,
      released.result,
      released.pressedSwitches,
      released.selfHold,
    );

    // 自己保持接点 NO(5) → コイル 14 の線が紫
    expect(view.wireOf.get("RY1:5-RY1:14")).toBe("self-hold");
    // 同じネットに載る起動ボタンからの引き込みも、切れば落ちるので同じ扱い
    expect(view.wireOf.get("S1:2-RY1:14")).toBe("self-hold");

    // 電源から接点 COM(9) までは通電中のまま（切っても落ちない、ではなく
    // 「落ちる枝」を絞り込んだ結果としてここは緑に残る）
    expect(view.wireOf.get("S2:2-RY1:9")).toBe("energized");
    expect(view.wireOf.get("PS1:plus-S2:1")).toBe("energized");
    // コイルの 0V 側も緑
    expect(view.wireOf.get("RY1:13-PS1:zero")).toBe("energized");

    expect(view.terminalOf.get("RY1:5")).toBe("self-hold");
    expect(view.terminalOf.get("RY1:9")).toBe("energized");
    expect(view.deviceOf.get("RY1")?.selfHeld).toBe(true);
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
