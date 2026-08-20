import { describe, expect, it } from "vitest";

import { buildLadder } from "@/circuit/adapter/ladder";
import { buildPathGraph, PLUS_NODE, ZERO_NODE, reachableFrom } from "@/circuit/adapter/path-graph";
import { componentRegistry } from "@/circuit/definitions";
import type { CircuitConnection, CircuitDocument } from "@/circuit/types";
import { terminalKey } from "@/circuit/types";

const wire = (from: string, to: string): CircuitConnection => {
  const [fromComponent, fromTerminal] = from.split(":");
  const [toComponent, toTerminal] = to.split(":");
  return { id: `${from}-${to}`, from: { componentId: fromComponent, terminalId: fromTerminal }, to: { componentId: toComponent, terminalId: toTerminal } };
};

const circuit = (withInput: boolean): CircuitDocument => ({
  version: 1,
  components: [
    { id: "AC1", definitionId: "power-ac100v", position: { x: 0, y: 0 } },
    { id: "PS1", definitionId: "omron-s8vm-05024", position: { x: 180, y: 0 } },
    { id: "PL1", definitionId: "lamp-dc24v", position: { x: 360, y: 0 } },
  ],
  connections: [
    ...(withInput ? [wire("AC1:L", "PS1:L"), wire("AC1:N", "PS1:N")] : []),
    wire("PS1:+V", "PL1:1"), wire("PL1:2", "PS1:-V"),
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
});

describe("S8VM-05024 の adapter 統合", () => {
  it("一次側が生きているときだけ二次側を電源として扱う", () => {
    const on = buildPathGraph(circuit(true), componentRegistry, new Set(), new Set());
    expect(reachableFrom(on, PLUS_NODE).has(terminalKey("PS1", "+V"))).toBe(true);
    expect(reachableFrom(on, ZERO_NODE).has(terminalKey("PS1", "-V"))).toBe(true);
    const off = buildPathGraph(circuit(false), componentRegistry, new Set(), new Set());
    expect(reachableFrom(off, PLUS_NODE).has(terminalKey("PS1", "+V"))).toBe(false);
    expect(reachableFrom(off, ZERO_NODE).has(terminalKey("PS1", "-V"))).toBe(false);
  });

  it("ラダー図では S8VM の DC 出力を電源母線として扱う", () => {
    const document: CircuitDocument = {
      version: 1,
      components: [
        { id: "PS1", definitionId: "omron-s8vm-05024", position: { x: 0, y: 0 } },
        { id: "PL1", definitionId: "lamp-dc24v", position: { x: 200, y: 0 } },
      ],
      connections: [wire("PS1:+V", "PL1:1"), wire("PL1:2", "PS1:-V")],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    const ladder = buildLadder(document, componentRegistry);
    const lamp = ladder.rungs.find((rung) => rung.output.componentId === "PL1");
    expect(lamp).toBeDefined();
    expect(lamp?.blocked).toBeUndefined();
  });
});
