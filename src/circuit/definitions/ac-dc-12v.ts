import type { ComponentDefinition } from "@/circuit/types";

/**
 * AC100V 系から DC12V を作る汎用スイッチング電源。
 *
 * BNS12SA-U1（BNS-12SA-U1）を代表例として、定格 AC100–115V、
 * 使用可能範囲 AC85–132V、DC12V / 0.9A（最大 10.8W）を採用する。
 * 端子名はシミュレーター上の論理名であり、実機の物理ピン番号を表さないため
 * `number` は持たせず `verified: false` とする。
 */
export const ac100vToDc12vPowerSupply: ComponentDefinition = {
  id: "power-ac100v-to-dc12v",
  model: "AC100V→DC12V 電源（BNS12SA-U1相当）",
  category: "power",
  terminals: [
    {
      id: "L",
      label: "L",
      role: "power_line",
      description: "AC入力 L / AC100V系",
      position: { x: 0, y: 0.3 },
      side: "left",
    },
    {
      id: "N",
      label: "N",
      role: "power_neutral",
      description: "AC入力 N / AC100V系",
      position: { x: 0, y: 0.7 },
      side: "left",
    },
    {
      id: "+V",
      label: "+12V",
      role: "power_positive",
      description: "DC出力 +V / DC12V",
      position: { x: 1, y: 0.3 },
      side: "right",
    },
    {
      id: "-V",
      label: "0V",
      role: "power_zero",
      description: "DC出力 -V / 0V",
      position: { x: 1, y: 0.7 },
      side: "right",
    },
  ],
  electrical: {
    kind: "ac-dc-power-supply",
    ratedInputVoltageMin: 100,
    ratedInputVoltageMax: 115,
    allowableInputVoltageMin: 85,
    allowableInputVoltageMax: 132,
    lineTerminal: "L",
    neutralTerminal: "N",
    outputVoltage: 12,
    positiveTerminal: "+V",
    zeroTerminal: "-V",
    ratedOutputCurrent: 0.9,
    ratedPower: 10.8,
  },
  visual: { width: 200, height: 160 },
  source: "https://www.marutsu.co.jp/contents/shop/marutsu/datasheet/ETA_BNS-SA.pdf",
  verified: false,
};
