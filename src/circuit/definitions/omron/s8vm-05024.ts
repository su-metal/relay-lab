import type { ComponentDefinition } from "@/circuit/types";

/**
 * OMRON S8VM-05024 — 50W / DC24V 2.2A、オープン・底面取りつけタイプ。
 *
 * OMRON 公式 S8VM 形式一覧:
 * - S8VM-05024 = 50W / 24V / 2.2A
 * - 全機種の入力は AC100〜240V フリー入力
 *
 * OMRON 公式 S8VM 接続資料（50W ブロック図）と nomenclature では、
 * 入力端子は L/N、オープンタイプの接地は FG、出力端子は -V/+V。
 * 図中の 1/2/3 は名称表の項目番号であり実端子番号ではないため `number` は持たせない。
 */
export const S8VM_05024_SOURCE =
  "https://www.fa.omron.co.jp/products/family/1616/network/";

export const omronS8vm05024: ComponentDefinition = {
  id: "omron-s8vm-05024",
  manufacturer: "OMRON",
  model: "S8VM-05024",
  category: "power",
  terminals: [
    {
      id: "L",
      label: "L",
      role: "power_line",
      description: "AC入力 L / AC100〜240V",
      position: { x: 0, y: 0.25 },
      side: "left",
    },
    {
      id: "N",
      label: "N",
      role: "power_neutral",
      description: "AC入力 N / AC100〜240V",
      position: { x: 0, y: 0.48 },
      side: "left",
    },
    {
      id: "FG",
      label: "FG",
      role: "generic",
      description: "FG / フレームグラウンド端子（保護接地）",
      position: { x: 0.5, y: 1 },
      side: "bottom",
    },
    {
      id: "-V",
      label: "-V",
      role: "power_zero",
      description: "DC出力 -V / DC24V",
      position: { x: 1, y: 0.62 },
      side: "right",
    },
    {
      id: "+V",
      label: "+V",
      role: "power_positive",
      description: "DC出力 +V / DC24V・定格2.2A",
      position: { x: 1, y: 0.34 },
      side: "right",
    },
  ],
  electrical: {
    kind: "ac-dc-power-supply",
    inputVoltageMin: 100,
    inputVoltageMax: 240,
    lineTerminal: "L",
    neutralTerminal: "N",
    outputVoltage: 24,
    positiveTerminal: "+V",
    zeroTerminal: "-V",
    ratedOutputCurrent: 2.2,
    ratedPower: 50,
  },
  visual: { width: 200, height: 180 },
  source: S8VM_05024_SOURCE,
  verified: true,
};
