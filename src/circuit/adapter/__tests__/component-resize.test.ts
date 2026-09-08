import { describe, expect, it } from "vitest";

import { terminalPoint } from "@/circuit/adapter/selection";
import { toDeviceNodes } from "@/circuit/adapter/reactflow";
import { componentRegistry, dc24vPowerSupply } from "@/circuit/definitions";
import type { CircuitDocument } from "@/circuit/types";
import { componentSizeOf, normalizeComponentSize } from "@/circuit/types";

const resizedDocument: CircuitDocument = {
  version: 1,
  components: [
    {
      id: "PS1",
      definitionId: dc24vPowerSupply.id,
      position: { x: 100, y: 50 },
      size: {
        width: dc24vPowerSupply.visual.width + 120,
        height: dc24vPowerSupply.visual.height + 80,
      },
    },
  ],
  connections: [],
  viewport: { x: 0, y: 0, zoom: 1 },
};

describe("リサイズした部品の表示寸法", () => {
  it("React Flow の style と measured に保存済み寸法を載せる", () => {
    const [node] = toDeviceNodes(resizedDocument, componentRegistry);
    const expected = resizedDocument.components[0].size;

    expect(node.style).toMatchObject(expected ?? {});
    expect(node.measured).toEqual(expected);
  });

  it("端子の相対座標をリサイズ後の外形へ展開する", () => {
    const instance = resizedDocument.components[0];
    const plus = dc24vPowerSupply.terminals.find((terminal) => terminal.id === "plus");
    if (!plus) throw new Error("+24V端子が見つからない");

    const point = terminalPoint(instance, dc24vPowerSupply, plus.id);
    const size = componentSizeOf(instance, dc24vPowerSupply);

    expect(point).toEqual({
      x: instance.position.x + plus.position.x * size.width,
      y: instance.position.y + plus.position.y * size.height,
    });
  });

  it("既定寸法未満の値は安全な最小寸法へ丸める", () => {
    expect(
      normalizeComponentSize(dc24vPowerSupply, { width: 1, height: 1 }),
    ).toBeUndefined();
    expect(
      componentSizeOf(
        { size: { width: 1, height: 1 } },
        dc24vPowerSupply,
      ),
    ).toEqual(dc24vPowerSupply.visual);
  });
});
