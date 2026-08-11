/**
 * プロパティパネルの読み取りの検証（design.md §8.3）。
 *
 * ここで守りたいのは US-D「押しボタンを押すと表示が即座に切り替わる」こと、
 * そして **停止中と非励磁を取り違えない**こと。実際にエンジンを回した結果を
 * 食わせるので、ブラウザを起動せずにパネルの表示内容を検証できる。
 */

import { describe, expect, it } from "vitest";

import { inspectComponent } from "@/circuit/adapter/inspection";
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
    {
      id: "l1",
      definitionId: "lamp-dc24v",
      label: "L1",
      position: at(420, 300),
    },
  ],
  connections: [
    wire("w-ps-s1", ["ps", "plus"], ["s1", "1"]),
    wire("w-s1-coil", ["s1", "2"], ["ry1", "14"]),
    wire("w-coil-zero", ["ry1", "13"], ["ps", "zero"]),
    wire("w-ps-com", ["ps", "plus"], ["ry1", "9"]),
    wire("w-no-lamp", ["ry1", "5"], ["l1", "1"]),
    wire("w-lamp-zero", ["l1", "2"], ["ps", "zero"]),
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
};

const inspect = (componentId: string | undefined, pressed: readonly string[]) => {
  const pressedSwitches = new Set(pressed);
  const result = simulate(document, componentRegistry, { pressedSwitches });
  return inspectComponent(
    document,
    componentRegistry,
    result,
    pressedSwitches,
    componentId,
  );
};

/** シミュレーション停止中（result が null） */
const inspectIdle = (componentId: string) =>
  inspectComponent(document, componentRegistry, null, new Set(), componentId);

describe("inspectComponent", () => {
  it("未選択・不明な部品は null を返す", () => {
    expect(inspect(undefined, [])).toBeNull();
    expect(inspect("no-such-component", [])).toBeNull();
  });

  it("インスタンスと定義をそのまま返す（型番・実端子番号の読み取り用）", () => {
    const inspection = inspect("ry1", []);

    expect(inspection?.instance.label).toBe("RY1");
    expect(inspection?.definition.model).toBe("MY4N");
    // 端子は定義の並び順のまま。飛び番でも詰め直さない
    expect(inspection?.terminals.map((t) => t.terminal.label)).toEqual([
      "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14",
    ]);
  });

  it("停止中は device も接点の開閉も undefined（非励磁と区別する）", () => {
    const inspection = inspectIdle("ry1");

    expect(inspection?.device).toBeUndefined();
    expect(inspection?.contacts).toHaveLength(4);
    for (const contact of inspection?.contacts ?? []) {
      expect(contact.closed).toBeUndefined();
    }
    for (const terminal of inspection?.terminals ?? []) {
      expect(terminal.state).toBeUndefined();
    }
  });

  it("非励磁のリレーは全接点が COM–NC 側で閉じている", () => {
    const inspection = inspect("ry1", []);

    expect(inspection?.device).toEqual({
      cutOff: false,
      energized: false,
      selfHeld: false,
      lit: false,
      pressed: false,
    });
    expect(inspection?.contacts.map((c) => c.closed)).toEqual([
      "nc",
      "nc",
      "nc",
      "nc",
    ]);
    // 第1接点の実端子番号（COM 9 / NC 1 / NO 5）が読める
    expect(inspection?.contacts[0].contact).toMatchObject({
      commonTerminal: "9",
      ncTerminal: "1",
      noTerminal: "5",
    });
    expect(inspection?.contacts[0].order).toBe(1);
  });

  it("押しボタンを押すと接点が COM–NO 側へ倒れる（US-D のリアルタイム更新）", () => {
    const inspection = inspect("ry1", ["s1"]);

    expect(inspection?.device?.energized).toBe(true);
    expect(inspection?.contacts.map((c) => c.closed)).toEqual([
      "no",
      "no",
      "no",
      "no",
    ]);
  });

  it("端子の電位が配線色と同じ状態で並ぶ", () => {
    const inspection = inspect("ry1", ["s1"]);
    const stateOf = (label: string) =>
      inspection?.terminals.find((t) => t.terminal.id === label)?.state;

    // 励磁したコイルの両端と、通電した第1接点 COM(9)–NO(5) は緑
    expect(stateOf("14")).toBe("energized");
    expect(stateOf("13")).toBe("energized");
    expect(stateOf("9")).toBe("energized");
    expect(stateOf("5")).toBe("energized");
    // NC(1) は励磁中に開くので浮く
    expect(stateOf("1")).toBe("inactive");
  });

  it("スイッチは押下と導通を別々に読める", () => {
    const released = inspect("s1", []);
    expect(released?.device?.pressed).toBe(false);
    expect(released?.conducting).toBe(false);

    const pressed = inspect("s1", ["s1"]);
    expect(pressed?.device?.pressed).toBe(true);
    expect(pressed?.conducting).toBe(true);
  });

  it("停止中のスイッチは導通状態を持たない", () => {
    expect(inspectIdle("s1")?.conducting).toBeUndefined();
  });

  it("ランプは点灯状態を持ち、接点は持たない", () => {
    expect(inspect("l1", ["s1"])?.device?.lit).toBe(true);
    expect(inspect("l1", [])?.device?.lit).toBe(false);
    expect(inspect("l1", [])?.contacts).toEqual([]);
  });
});

/**
 * 逆起電力吸収ダイオードの読み取り（design.md §5.4）。
 *
 * 「どのコイルと並列か・向きは正しいか」は**配線そのものの性質**であって
 * 実行中にしか決まらない値ではない。停止中でもパネルに出せることを確かめる。
 */
describe("inspectComponent（ダイオード）", () => {
  /** RY1 のコイル（14 が +、13 が −）と並列にダイオードを 1 本足す */
  const withDiode = (toCoilPlus: "a" | "k"): CircuitDocument => ({
    ...document,
    components: [
      ...document.components,
      { id: "d1", definitionId: "diode-generic", label: "D1", position: at(620, 0) },
    ],
    connections: [
      ...document.connections,
      wire("w-d-plus", ["d1", toCoilPlus], ["ry1", "14"]),
      wire("w-d-minus", ["d1", toCoilPlus === "k" ? "a" : "k"], ["ry1", "13"]),
    ],
  });

  const inspectDiodeIn = (
    doc: CircuitDocument,
    pressed: readonly string[] | null,
  ) => {
    const pressedSwitches = new Set(pressed ?? []);
    const result =
      pressed === null
        ? null
        : simulate(doc, componentRegistry, { pressedSwitches });
    return inspectComponent(doc, componentRegistry, result, pressedSwitches, "d1")
      ?.diode;
  };

  it("停止中でも「どのコイルと並列か」と向きが読める", () => {
    expect(inspectDiodeIn(withDiode("k"), null)).toMatchObject({
      flyback: { relayId: "ry1", orientation: "protective" },
      flybackRelayName: "RY1",
    });
    expect(inspectDiodeIn(withDiode("a"), null)?.flyback?.orientation).toBe(
      "reversed",
    );
  });

  it("正しい向きなら通電中も逆バイアスで、短絡していない", () => {
    expect(inspectDiodeIn(withDiode("k"), ["s1"])).toMatchObject({
      bias: "reverse",
      shorting: false,
    });
  });

  it("逆挿しは通電すると順方向になり短絡する", () => {
    expect(inspectDiodeIn(withDiode("a"), ["s1"])).toMatchObject({
      bias: "forward",
      shorting: true,
    });
  });

  it("ダイオード以外の部品は diode を持たない", () => {
    expect(inspect("ry1", [])?.diode).toBeUndefined();
  });
});
