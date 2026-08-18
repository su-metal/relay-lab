/**
 * 静止状態の到達範囲の検証（design.md §5.15）。
 *
 * ここで守りたいのは 4 点。
 * ①収束ループを回さずに（`simulate()` を呼ばずに）電位の届く範囲が決まること
 * ②「電位がどこで止まっているか」が端子の組で取れること
 * ③b 接点の直列チェーン（起動経路）は静止状態で**通っている**と出ること
 * ④閉じれば短絡になる接点を「あと少しで励磁します」の顔で出さないこと
 */

import { describe, expect, it } from "vitest";

import { componentRegistry } from "@/circuit/definitions";
import { previewAtRest } from "@/circuit/engine";
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

/** 端子が属するネットの電位状態を引く小道具 */
const stateOf = (
  preview: ReturnType<typeof previewAtRest>,
  componentId: string,
  terminalId: string,
) => {
  const netId = preview.netOf.get(terminalKey(componentId, terminalId));
  return netId === undefined ? undefined : preview.netState.get(netId);
};

describe("previewAtRest — 電位の到達範囲", () => {
  it("電源に直結した端子まで電位が届く", () => {
    const preview = previewAtRest(document, componentRegistry);

    expect(stateOf(preview, "s1", "1")?.plusFrom.has("ps")).toBe(true);
    expect(stateOf(preview, "ry1", "9")?.plusFrom.has("ps")).toBe(true);
    expect(stateOf(preview, "ry1", "13")?.zeroFrom.has("ps")).toBe(true);
    expect(stateOf(preview, "l1", "2")?.zeroFrom.has("ps")).toBe(true);
  });

  it("A 接点・押しボタンの先には届かない", () => {
    const preview = previewAtRest(document, componentRegistry);

    // S1 を押していないので 2 番の先（コイル 14）には来ない
    expect(stateOf(preview, "s1", "2")?.plusFrom.size).toBe(0);
    expect(stateOf(preview, "ry1", "14")?.plusFrom.size).toBe(0);
    // RY1 が励磁していないので COM(9)–NO(5) は開いたまま
    expect(stateOf(preview, "ry1", "5")?.plusFrom.size).toBe(0);
  });

  it("押しボタン式の回路では静止状態で何も励磁しない", () => {
    const preview = previewAtRest(document, componentRegistry);

    expect(preview.energizedCoils.size).toBe(0);
    expect(preview.litLamps.size).toBe(0);
  });

  it("電源に直結したコイルは静止状態でも励磁すると出る", () => {
    const direct: CircuitDocument = {
      ...document,
      connections: [
        wire("w-plus-coil", ["ps", "plus"], ["ry1", "14"]),
        wire("w-coil-zero", ["ry1", "13"], ["ps", "zero"]),
      ],
    };
    const preview = previewAtRest(direct, componentRegistry);

    expect([...preview.energizedCoils]).toEqual(["ry1"]);
  });

  it("b 接点の直列チェーン（起動経路）は静止状態で通っている", () => {
    const chain: CircuitDocument = {
      ...document,
      connections: [
        // +24V → RY1 の b 接点 9–1 → ランプ → 0V
        wire("w-ps-com", ["ps", "plus"], ["ry1", "9"]),
        wire("w-nc-lamp", ["ry1", "1"], ["l1", "1"]),
        wire("w-lamp-zero", ["l1", "2"], ["ps", "zero"]),
      ],
    };
    const preview = previewAtRest(chain, componentRegistry);

    expect(stateOf(preview, "ry1", "1")?.plusFrom.has("ps")).toBe(true);
    expect([...preview.litLamps]).toEqual(["l1"]);
  });

  it("部品が 1 つも無くても空の解を返す", () => {
    const preview = previewAtRest(
      { version: 1, components: [], connections: [], viewport: document.viewport },
      componentRegistry,
    );

    expect(preview.blockers).toEqual([]);
    expect(preview.energizedCoils.size).toBe(0);
  });
});

describe("previewAtRest — 電位が止まっている箇所", () => {
  it("押していない押しボタンを + 側の先端として拾う", () => {
    const preview = previewAtRest(document, componentRegistry);

    expect(preview.blockers).toContainEqual({
      componentId: "s1",
      fedTerminalId: "1",
      blockedTerminalId: "2",
      side: "plus",
    });
  });

  it("非励磁の A 接点も先端として拾う", () => {
    const preview = previewAtRest(document, componentRegistry);

    // COM(9) に + が来ていて、NO(5) へは行かない
    expect(preview.blockers).toContainEqual({
      componentId: "ry1",
      fedTerminalId: "9",
      blockedTerminalId: "5",
      side: "plus",
    });
    /*
     * 電位が来ていない残り 3 回路（COM 10 / 11 / 12）は拾わない。
     * **負荷の先も拾わない** —— NO(5) の先はランプ経由で 0V に繋がっているが、
     * 負荷は union されない（design.md §5.2）ので 5 番のネットは 0V に届かない。
     * 押しボタンと合わせて 2 件で全部
     */
    expect(preview.blockers).toHaveLength(2);
  });

  it("どちらにも電位が来ていない接点は先端にしない", () => {
    const floating: CircuitDocument = {
      ...document,
      connections: [wire("w-orphan", ["ry1", "10"], ["l1", "1"])],
    };
    const preview = previewAtRest(floating, componentRegistry);

    expect(preview.blockers).toEqual([]);
  });

  it("閉じれば短絡になる接点は先端にしない", () => {
    const shorting: CircuitDocument = {
      ...document,
      connections: [
        // 押すと +24V と 0V が直結する押しボタン。負荷を挟んでいない
        wire("w-ps-s1", ["ps", "plus"], ["s1", "1"]),
        wire("w-s1-zero", ["s1", "2"], ["ps", "zero"]),
      ],
    };
    const preview = previewAtRest(shorting, componentRegistry);

    expect(
      preview.blockers.filter((blocker) => blocker.componentId === "s1"),
    ).toEqual([]);
  });

  it("押していない b 接点は閉じているので先端にならない", () => {
    const nc: CircuitDocument = {
      ...document,
      components: [
        ...components,
        {
          id: "s2",
          definitionId: "switch-pushbutton-nc",
          label: "S2",
          position: at(200, 300),
        },
      ],
      connections: [
        wire("w-ps-s2", ["ps", "plus"], ["s2", "1"]),
        wire("w-s2-lamp", ["s2", "2"], ["l1", "1"]),
        wire("w-lamp-zero", ["l1", "2"], ["ps", "zero"]),
      ],
    };
    const preview = previewAtRest(nc, componentRegistry);

    expect(
      preview.blockers.filter((blocker) => blocker.componentId === "s2"),
    ).toEqual([]);
    // 閉じているので静止状態でランプが点く
    expect([...preview.litLamps]).toEqual(["l1"]);
  });
});
