/**
 * 経路確認モードの表示状態の検証（design.md §5.15・§8.14）。
 *
 * ここで守りたいのは 4 点。
 * ①実行中と同じ `WireState` の語彙で色が付くこと（予測専用の色を作らない）
 * ②`deviceOf` が空のままであること —— 部品を「動いている」と言わない
 * ③止まっている箇所が**実端子番号**で読めること（このプロダクトの価値そのもの）
 * ④自己保持の紫が静止状態には出ないこと
 */

import { describe, expect, it } from "vitest";

import { buildPathPreview } from "@/circuit/adapter/path-preview";
import { componentRegistry } from "@/circuit/definitions";
import type { CircuitConnection, CircuitDocument } from "@/circuit/types";
import { terminalKey } from "@/circuit/types";

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

const components: CircuitDocument["components"] = [
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
];

/** `+24V → S1(A接点) → RY1 コイル 14 / 13 → 0V` と、RY1 の第1接点で点くランプ */
const document: CircuitDocument = {
  version: 1,
  components,
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

describe("buildPathPreview — 配線と端子の色", () => {
  it("電位が届いている線を + 側 / 0V に塗り、届かない線は inactive にする", () => {
    const preview = buildPathPreview(document, componentRegistry);

    expect(preview.view.wireOf.get("w-ps-s1")).toBe("plus");
    expect(preview.view.wireOf.get("w-ps-com")).toBe("plus");
    expect(preview.view.wireOf.get("w-coil-zero")).toBe("zero");
    expect(preview.view.wireOf.get("w-lamp-zero")).toBe("zero");

    // 押していない S1 の先と、開いている A 接点の先
    expect(preview.view.wireOf.get("w-s1-coil")).toBe("inactive");
    expect(preview.view.wireOf.get("w-no-lamp")).toBe("inactive");
  });

  it("端子にも同じ色を付ける", () => {
    const preview = buildPathPreview(document, componentRegistry);

    expect(preview.view.terminalOf.get(terminalKey("s1", "1"))).toBe("plus");
    expect(preview.view.terminalOf.get(terminalKey("s1", "2"))).toBe("inactive");
    expect(preview.view.terminalOf.get(terminalKey("ry1", "13"))).toBe("zero");
  });

  it("静止状態で成立する負荷の経路は通電色になる", () => {
    const direct: CircuitDocument = {
      ...document,
      connections: [
        wire("w-plus-coil", ["ps", "plus"], ["ry1", "14"]),
        wire("w-coil-zero", ["ry1", "13"], ["ps", "zero"]),
      ],
    };
    const preview = buildPathPreview(direct, componentRegistry);

    expect(preview.view.wireOf.get("w-plus-coil")).toBe("energized");
    expect(preview.view.wireOf.get("w-coil-zero")).toBe("energized");
    expect(preview.activeLoadCount).toBe(1);
  });

  it("部品そのものは「動いていない」ままにする", () => {
    const direct: CircuitDocument = {
      ...document,
      connections: [
        wire("w-plus-coil", ["ps", "plus"], ["ry1", "14"]),
        wire("w-coil-zero", ["ry1", "13"], ["ps", "zero"]),
      ],
    };
    const preview = buildPathPreview(direct, componentRegistry);

    // `deviceOf` の有無が「シミュレーション中か」の唯一の合図（reactflow.ts）
    expect(preview.view.deviceOf.size).toBe(0);
  });

  it("自己保持の紫は静止状態には出ない", () => {
    const preview = buildPathPreview(document, componentRegistry);

    expect([...preview.view.wireOf.values()]).not.toContain("self-hold");
  });

  it("静止状態の電源短絡は short として出す", () => {
    const shorted: CircuitDocument = {
      ...document,
      connections: [wire("w-short", ["ps", "plus"], ["ps", "zero"])],
    };
    const preview = buildPathPreview(shorted, componentRegistry);

    expect(preview.view.wireOf.get("w-short")).toBe("short");
  });

  it("部品が 1 つも無ければ何も塗らない", () => {
    const preview = buildPathPreview(
      { version: 1, components: [], connections: [], viewport: document.viewport },
      componentRegistry,
    );

    expect(preview.view.wireOf.size).toBe(0);
    expect(preview.blockers).toEqual([]);
  });
});

describe("buildPathPreview — 止まっている箇所", () => {
  it("実端子番号と呼び名で言う", () => {
    const preview = buildPathPreview(document, componentRegistry);

    expect(preview.blockers).toContainEqual({
      componentId: "s1",
      name: "S1",
      fedLabel: "1",
      blockedLabel: "2",
      side: "plus",
      action: "操作すると閉じます",
    });
    expect(preview.blockers).toContainEqual({
      componentId: "ry1",
      name: "RY1",
      fedLabel: "9",
      blockedLabel: "5",
      side: "plus",
      action: "このリレーが動作すると閉じます",
    });
  });

  it("止まっている部品をキャンバスの目印用に集める", () => {
    const preview = buildPathPreview(document, componentRegistry);

    expect([...preview.blockedComponentIds].sort()).toEqual(["ry1", "s1"]);
  });

  it("ラベルが無ければ型番で呼ぶ", () => {
    const unlabeled: CircuitDocument = {
      ...document,
      components: components.map((instance) =>
        instance.id === "s1" ? { ...instance, label: undefined } : instance,
      ),
    };
    const preview = buildPathPreview(unlabeled, componentRegistry);

    expect(
      preview.blockers.find((blocker) => blocker.componentId === "s1")?.name,
    ).toBe(componentRegistry.get("switch-pushbutton-no")?.model);
  });

  it("タイマーの接点は限時であることを添える", () => {
    const timer: CircuitDocument = {
      ...document,
      components: [
        ...components,
        {
          id: "t1",
          definitionId: "timer-on-delay",
          label: "T1",
          position: at(640, 0),
        },
      ],
      connections: [wire("w-ps-t-com", ["ps", "plus"], ["t1", "3"])],
    };
    const preview = buildPathPreview(timer, componentRegistry);

    const blocker = preview.blockers.find(
      (entry) => entry.componentId === "t1",
    );
    expect(blocker?.action).toBe("この限時接点が動作すると閉じます");
  });
});
