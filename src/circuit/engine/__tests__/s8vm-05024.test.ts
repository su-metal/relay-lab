import { describe, expect, it } from "vitest";

import { componentRegistry, omronS8vm05024 } from "@/circuit/definitions";
import { simulate } from "@/circuit/engine";
import type { CircuitConnection, CircuitDocument } from "@/circuit/types";

const wire = (from: string, to: string): CircuitConnection => {
  const [fromComponent, fromTerminal] = from.split(":");
  const [toComponent, toTerminal] = to.split(":");
  return {
    id: `${from}-${to}`,
    from: { componentId: fromComponent, terminalId: fromTerminal },
    to: { componentId: toComponent, terminalId: toTerminal },
  };
};

const makeCircuit = (withInput: boolean): CircuitDocument => ({
  version: 1,
  components: [
    { id: "AC1", definitionId: "power-ac100v", label: "AC1", position: { x: 0, y: 0 } },
    { id: "PS1", definitionId: "omron-s8vm-05024", label: "PS1", position: { x: 200, y: 0 } },
    { id: "PL1", definitionId: "lamp-dc24v", label: "PL1", position: { x: 400, y: 0 } },
  ],
  connections: [
    ...(withInput ? [wire("AC1:L", "PS1:L"), wire("AC1:N", "PS1:N")] : []),
    wire("PS1:+V", "PL1:1"),
    wire("PL1:2", "PS1:-V"),
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
});

describe("OMRON S8VM-05024", () => {
  it("公式仕様の端子と定格を保持する", () => {
    expect(omronS8vm05024.manufacturer).toBe("OMRON");
    expect(omronS8vm05024.model).toBe("S8VM-05024");
    expect(omronS8vm05024.terminals.map((terminal) => terminal.id)).toEqual([
      "L", "N", "FG", "-V", "+V",
    ]);
    expect(omronS8vm05024.verified).toBe(true);
    expect(omronS8vm05024.electrical).toMatchObject({
      kind: "ac-dc-power-supply",
      ratedInputVoltageMin: 100,
      ratedInputVoltageMax: 240,
      allowableInputVoltageMin: 85,
      allowableInputVoltageMax: 265,
      outputVoltage: 24,
      ratedOutputCurrent: 2.2,
      ratedPower: 50,
    });
  });

  it("AC100V が L/N に来たときだけ DC24V 出力が有効になる", () => {
    const powered = simulate(makeCircuit(true), componentRegistry, { pressedSwitches: new Set() });
    expect(powered.litLamps.has("PL1")).toBe(true);

    const unpowered = simulate(makeCircuit(false), componentRegistry, { pressedSwitches: new Set() });
    expect(unpowered.litLamps.has("PL1")).toBe(false);
  });

  it("DC 出力短絡を検出する", () => {
    const document = makeCircuit(true);
    document.connections.push(wire("PS1:+V", "PS1:-V"));
    const result = simulate(document, componentRegistry, { pressedSwitches: new Set() });
    expect(result.warnings.some((warning) =>
      warning.code === "power-short-circuit" && warning.componentId === "PS1"
    )).toBe(true);
  });
});
