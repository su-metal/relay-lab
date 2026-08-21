import { describe, expect, it } from "vitest";

import { buildWireLanes } from "@/circuit/adapter/wire-lane";
import { componentRegistry } from "@/circuit/definitions";
import type { CircuitConnection, CircuitDocument } from "@/circuit/types";
import { componentSizeOf } from "@/circuit/types";

const wire = (
  id: string,
  from: [string, string],
  to: [string, string],
): CircuitConnection => ({
  id,
  from: { componentId: from[0], terminalId: from[1] },
  to: { componentId: to[0], terminalId: to[1] },
});

const outside = (value: number, min: number, max: number): boolean =>
  value <= min || value >= max;

describe("buildWireLanes — リサイズ後の障害物回避", () => {
  it("大きく広げた同一部品の上下端子を結んでも本体の外へ回り込む", () => {
    const definition = componentRegistry.get("omron-my4n-dc24")!;
    const instance = {
      id: "ry",
      definitionId: definition.id,
      position: { x: 0, y: 0 },
      size: { width: 1000, height: 500 },
    };
    const document: CircuitDocument = {
      version: 1,
      components: [instance],
      connections: [wire("w1", ["ry", "1"], ["ry", "5"])],
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    const size = componentSizeOf(instance, definition);
    const top = definition.terminals.find((terminal) => terminal.id === "1")!;
    const actualRunX = instance.position.x + top.position.x * size.width;
    expect(actualRunX).toBeGreaterThan(instance.position.x);
    expect(actualRunX).toBeLessThan(instance.position.x + size.width);

    const shift = buildWireLanes(document, componentRegistry).get("w1") ?? 0;
    expect(shift).not.toBe(0);
    expect(
      outside(
        actualRunX + shift,
        instance.position.x,
        instance.position.x + size.width,
      ),
    ).toBe(true);
  });

  it("既定寸法では当たらないが拡大後には当たる中間部品も避ける", () => {
    const obstacleDefinition = componentRegistry.get("omron-my4n-dc24")!;
    const obstacle = {
      id: "ry",
      definitionId: obstacleDefinition.id,
      position: { x: 300, y: 200 },
      size: { width: 400, height: 600 },
    };
    const document: CircuitDocument = {
      version: 1,
      components: [
        {
          id: "ps",
          definitionId: "power-dc24v",
          position: { x: 0, y: 461 },
        },
        obstacle,
        {
          id: "lamp",
          definitionId: "lamp-dc24v",
          position: { x: 1000, y: 435 },
        },
      ],
      // 右辺 → 右辺なので、走行は source（電源 +）の高さを横へ進む。
      connections: [wire("w1", ["ps", "plus"], ["lamp", "2"])],
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    const power = componentRegistry.get("power-dc24v")!;
    const plus = power.terminals.find((terminal) => terminal.id === "plus")!;
    const powerSize = componentSizeOf(document.components[0], power);
    const runY = document.components[0].position.y + plus.position.y * powerSize.height;

    // 既定 MY4N（240px 高）なら y=500 は下を通るが、600px に拡大した実寸では本体内。
    expect(runY).toBeGreaterThan(
      obstacle.position.y + obstacleDefinition.visual.height,
    );
    expect(runY).toBeLessThan(obstacle.position.y + obstacle.size.height);

    const shift = buildWireLanes(document, componentRegistry).get("w1") ?? 0;
    expect(shift).not.toBe(0);
    expect(
      outside(
        runY + shift,
        obstacle.position.y,
        obstacle.position.y + obstacle.size.height,
      ),
    ).toBe(true);
  });
});
