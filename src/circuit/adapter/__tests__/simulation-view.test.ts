/**
 * 表示状態の導出の検証（design.md §5.6・§8.2）。
 *
 * ここで守りたいのは「緑＝通電中」がネットの 2 ビットではなく
 * **負荷側の結果から決まる**こと、そして電源短絡を緑にしないこと。
 * 実際にエンジンを回した結果を食わせるので、UI を起動せずに配線色を検証できる。
 */

import { describe, expect, it } from "vitest";

import {
  buildSimulationView,
  terminalStatesOf,
} from "@/circuit/adapter/simulation-view";
import { componentRegistry } from "@/circuit/definitions";
import { simulate } from "@/circuit/engine";
import type { CircuitConnection, CircuitDocument } from "@/circuit/types";

const wire = (
  id: string,
  from: [string, string],
  to: [string, string],
): CircuitConnection => ({
  id,
  from: { componentId: from[0], terminalId: from[1] },
  to: { componentId: to[0], terminalId: to[1] },
});

const at = (x: number, y: number) => ({ x, y });

/** `+24V → S1(A接点) → RY1 コイル 14 / 13 → 0V` と、RY1 の第1接点で点くランプ */
const document: CircuitDocument = {
  version: 1,
  components: [
    { id: "ps", definitionId: "power-dc24v", label: "PS1", position: at(0, 0) },
    {
      id: "s1",
      definitionId: "switch-pushbutton-no",
      label: "S1",
      position: at(200, 0),
    },
    {
      id: "ry1",
      definitionId: "omron-my4n-dc24",
      label: "RY1",
      position: at(420, 0),
    },
    { id: "l1", definitionId: "lamp-dc24v", label: "L1", position: at(420, 300) },
  ],
  connections: [
    wire("w-ps-s1", ["ps", "plus"], ["s1", "1"]),
    wire("w-s1-coil", ["s1", "2"], ["ry1", "14"]),
    wire("w-coil-zero", ["ry1", "13"], ["ps", "zero"]),
    // 第1接点 COM(9) に + を入れ、NO(5) からランプへ
    wire("w-ps-com", ["ps", "plus"], ["ry1", "9"]),
    wire("w-no-lamp", ["ry1", "5"], ["l1", "1"]),
    wire("w-lamp-zero", ["l1", "2"], ["ps", "zero"]),
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
};

const viewFor = (pressed: readonly string[]) => {
  const pressedSwitches = new Set(pressed);
  const result = simulate(document, componentRegistry, { pressedSwitches });
  return {
    result,
    view: buildSimulationView(
      document,
      componentRegistry,
      result,
      pressedSwitches,
    ),
  };
};

describe("buildSimulationView", () => {
  it("停止中（result が null）はすべて空を返す", () => {
    const view = buildSimulationView(
      document,
      componentRegistry,
      null,
      new Set(),
    );
    expect(view.wireOf.size).toBe(0);
    expect(view.terminalOf.size).toBe(0);
    expect(view.deviceOf.size).toBe(0);
  });

  it("非押下時は + 側が赤、0V 側が青、負荷の先は非通電", () => {
    const { result, view } = viewFor([]);

    expect(result.status).toBe("stable");
    expect(result.energizedRelays.size).toBe(0);

    expect(view.wireOf.get("w-ps-s1")).toBe("plus");
    expect(view.wireOf.get("w-coil-zero")).toBe("zero");
    // S1 が開いているのでコイル + 側はどちらの電源にも到達しない
    expect(view.wireOf.get("w-s1-coil")).toBe("inactive");
    // 第1接点は非励磁で COM–NC。NO 側のランプ経路は死んでいる
    expect(view.wireOf.get("w-no-lamp")).toBe("inactive");
  });

  it("押下すると通電経路が energized になる（緑は負荷側の結果から決まる）", () => {
    const { result, view } = viewFor(["s1"]);

    expect(result.status).toBe("stable");
    expect([...result.energizedRelays]).toEqual(["ry1"]);
    expect([...result.litLamps]).toEqual(["l1"]);

    // コイルの両側は励磁したコイルに隣接するので緑
    expect(view.wireOf.get("w-s1-coil")).toBe("energized");
    expect(view.wireOf.get("w-coil-zero")).toBe("energized");
    // 同じネットに載っている電源からスイッチまでの経路も緑
    expect(view.wireOf.get("w-ps-s1")).toBe("energized");
    // ランプの両側も点灯しているので緑
    expect(view.wireOf.get("w-no-lamp")).toBe("energized");
    expect(view.wireOf.get("w-lamp-zero")).toBe("energized");
  });

  it("部品の状態（励磁・点灯・押下）を componentId で引ける", () => {
    const { view } = viewFor(["s1"]);

    expect(view.deviceOf.get("ry1")).toEqual({
      energized: true,
      lit: false,
      pressed: false,
    });
    expect(view.deviceOf.get("l1")).toEqual({
      energized: false,
      lit: true,
      pressed: false,
    });
    expect(view.deviceOf.get("s1")).toEqual({
      energized: false,
      lit: false,
      pressed: true,
    });
  });

  it("実行中は全部品にエントリがある（停止中との区別に使う）", () => {
    const { view } = viewFor([]);
    expect([...view.deviceOf.keys()].sort()).toEqual(["l1", "ps", "ry1", "s1"]);
  });

  it("電源短絡したネットは緑ではなく short にする", () => {
    const shorted: CircuitDocument = {
      ...document,
      connections: [wire("w-short", ["ps", "plus"], ["ps", "zero"])],
    };
    const result = simulate(shorted, componentRegistry, {
      pressedSwitches: new Set(),
    });
    const view = buildSimulationView(
      shorted,
      componentRegistry,
      result,
      new Set(),
    );

    expect(
      result.warnings.some((warning) => warning.code === "power-short-circuit"),
    ).toBe(true);
    expect(view.wireOf.get("w-short")).toBe("short");
  });
});

describe("terminalStatesOf", () => {
  it("部品 1 個ぶんの端子状態を端子 ID で引ける形に切り出す", () => {
    const { view } = viewFor(["s1"]);
    const states = terminalStatesOf(view, "ry1", ["14", "13", "9", "5", "1"]);

    expect(states?.get("14")).toBe("energized");
    expect(states?.get("13")).toBe("energized");
    // COM(9) と NO(5) は励磁で導通し、ランプへ電流が流れている
    expect(states?.get("9")).toBe("energized");
    expect(states?.get("5")).toBe("energized");
    // NC(1) は励磁中に開くので浮く
    expect(states?.get("1")).toBe("inactive");
  });

  it("停止中は undefined を返す（ノードに空のマップを渡さない）", () => {
    const view = buildSimulationView(
      document,
      componentRegistry,
      null,
      new Set(),
    );
    expect(terminalStatesOf(view, "ry1", ["14"])).toBeUndefined();
  });
});
