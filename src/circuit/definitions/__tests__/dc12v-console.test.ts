import { describe, expect, it } from "vitest";

import {
  ac100vToDc12vPowerSupply,
  dimmingConsole,
  requireComponentDefinition,
} from "@/circuit/definitions";

describe("AC100V→DC12V 電源", () => {
  it("BNS12SA-U1相当の入出力仕様を持つ", () => {
    expect(ac100vToDc12vPowerSupply.model).toContain("BNS12SA-U1相当");
    expect(ac100vToDc12vPowerSupply.terminals.map((terminal) => terminal.id)).toEqual([
      "L",
      "N",
      "+V",
      "-V",
    ]);

    const { electrical } = ac100vToDc12vPowerSupply;
    if (electrical.kind !== "ac-dc-power-supply") {
      throw new Error("AC-DC 電源ではない");
    }
    expect(electrical).toMatchObject({
      ratedInputVoltageMin: 100,
      ratedInputVoltageMax: 115,
      allowableInputVoltageMin: 85,
      allowableInputVoltageMax: 132,
      outputVoltage: 12,
      ratedOutputCurrent: 0.9,
      ratedPower: 10.8,
      lineTerminal: "L",
      neutralTerminal: "N",
      positiveTerminal: "+V",
      zeroTerminal: "-V",
    });
  });

  it("パレット用レジストリから取得できる", () => {
    expect(requireComponentDefinition("power-ac100v-to-dc12v")).toBe(
      ac100vToDc12vPowerSupply,
    );
  });
});

describe("新型調光操作卓の電源端子", () => {
  it("端子14/15がAC100VではなくDC12V入力になっている", () => {
    const terminal14 = dimmingConsole.terminals.find((terminal) => terminal.id === "14");
    const terminal15 = dimmingConsole.terminals.find((terminal) => terminal.id === "15");

    expect(terminal14).toMatchObject({
      role: "power_positive",
      description: expect.stringContaining("DC12V（＋）入力"),
    });
    expect(terminal15).toMatchObject({
      role: "power_zero",
      description: expect.stringContaining("DC12V（0V）入力"),
    });
    expect(`${terminal14?.description} ${terminal15?.description}`).not.toContain(
      "AC100V",
    );
  });
});
