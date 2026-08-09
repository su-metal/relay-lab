/**
 * 端子ツールチップの「接続先」情報の検証（design.md §8.3）。
 *
 * 見たいのは配線そのものが正しく相手側に化けること。ネットまで辿って
 * 間接的な接続先まで拾っていないかも合わせて確認する。
 */

import { describe, expect, it } from "vitest";

import { buildTerminalConnections } from "@/circuit/adapter/terminal-connections";
import { componentRegistry } from "@/circuit/definitions";
import type { CircuitConnection, CircuitDocument } from "@/circuit/types";
import { terminalRefKey } from "@/circuit/types";

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
  ],
  connections: [
    wire("w-ps-s1", ["ps", "plus"], ["s1", "1"]),
    wire("w-s1-coil", ["s1", "2"], ["ry1", "14"]),
    // 端子台のように 1 端子へ複数の配線が集まるケース
    wire("w-ps-com", ["ps", "plus"], ["ry1", "9"]),
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
};

describe("buildTerminalConnections", () => {
  it("配線の相手側を端子ごとに引ける", () => {
    const table = buildTerminalConnections(document, componentRegistry);

    const s1Terminal2 = table.get(terminalRefKey({ componentId: "s1", terminalId: "2" }));
    expect(s1Terminal2).toEqual([{ componentName: "RY1", terminalLabel: "14" }]);

    const ry1Terminal14 = table.get(
      terminalRefKey({ componentId: "ry1", terminalId: "14" }),
    );
    expect(ry1Terminal14).toEqual([{ componentName: "S1", terminalLabel: "2" }]);
  });

  it("同じ電源端子から複数本つながっていれば配列に両方入る", () => {
    const table = buildTerminalConnections(document, componentRegistry);

    const psPlus = table.get(terminalRefKey({ componentId: "ps", terminalId: "plus" }));
    expect(psPlus).toHaveLength(2);
    expect(psPlus).toEqual(
      expect.arrayContaining([
        { componentName: "S1", terminalLabel: "1" },
        { componentName: "RY1", terminalLabel: "9" },
      ]),
    );
  });

  it("配線が無い端子は表に現れない", () => {
    const table = buildTerminalConnections(document, componentRegistry);
    expect(
      table.get(terminalRefKey({ componentId: "ry1", terminalId: "5" })),
    ).toBeUndefined();
  });

  it("ラベルが無い部品は型番で名乗る", () => {
    const unlabeled: CircuitDocument = {
      ...document,
      components: document.components.map((instance) =>
        instance.id === "ry1" ? { ...instance, label: undefined } : instance,
      ),
    };
    const table = buildTerminalConnections(unlabeled, componentRegistry);
    const s1Terminal2 = table.get(
      terminalRefKey({ componentId: "s1", terminalId: "2" }),
    );
    expect(s1Terminal2?.[0].componentName).toBe("MY4N");
  });

  it("レジストリに無い定義 ID の部品は接続先として出さない", () => {
    const withUnknown: CircuitDocument = {
      ...document,
      components: [
        ...document.components,
        { id: "ghost", definitionId: "not-registered", position: at(0, 400) },
      ],
      connections: [
        ...document.connections,
        wire("w-ghost", ["ghost", "a"], ["ry1", "13"]),
      ],
    };
    const table = buildTerminalConnections(withUnknown, componentRegistry);
    expect(
      table.get(terminalRefKey({ componentId: "ry1", terminalId: "13" })),
    ).toBeUndefined();
  });
});
