import type { ComponentDefinition } from "@/circuit/types";

/**
 * OMRON S8VM-05024 — 50W / DC24V 2.2A、オープン・底面取りつけタイプ。
 *
 * OMRON 公式資料:
 * - 形式/種類: S8VM-05024 = 50W / 24V / 2.2A、オープン・底面取りつけ
 *   https://www.fa.omron.co.jp/products/family/1616/lineup/
 * - 定格/性能: 定格入力 AC100〜240V、使用可能範囲 AC85〜265V
 *   https://www.fa.omron.co.jp/products/family/1616/specification/
 * - 配線/接続: 「形S8VM-050□□□□（50W）」ブロック図
 *   https://www.fa.omron.co.jp/products/family/1616/network/
 *
 * 実機の端子表示は L / N / FG / -V / +V。
 * 資料中の 1 / 2 / 3 は説明項目番号で、物理端子番号ではない。
 * `number` には実機に刻印される端子記号そのものを保持する。
 */
export const S8VM_05024_SOURCE =
  "https://www.fa.omron.co.jp/products/family/1616/network/";

export const omronS8vm05024: ComponentDefinition = {
  id: "omron-s8vm-05024",
  manufacturer: "OMRON",
  model: "S8VM-05024",
  category: "power",
  terminals: [
    { id: "L", label: "L", number: "L", role: "power_line", description: "AC入力 L / 定格AC100〜240V（使用可能範囲AC85〜265V）", position: { x: 0, y: 0.25 }, side: "left" },
    { id: "N", label: "N", number: "N", role: "power_neutral", description: "AC入力 N / 定格AC100〜240V（使用可能範囲AC85〜265V）", position: { x: 0, y: 0.48 }, side: "left" },
    { id: "FG", label: "FG", number: "FG", role: "generic", description: "FG / フレームグラウンド端子（保護接地）", position: { x: 0.5, y: 1 }, side: "bottom" },
    { id: "-V", label: "-V", number: "-V", role: "power_zero", description: "DC出力 -V / DC24V", position: { x: 1, y: 0.62 }, side: "right" },
    { id: "+V", label: "+V", number: "+V", role: "power_positive", description: "DC出力 +V / DC24V・定格2.2A", position: { x: 1, y: 0.34 }, side: "right" },
  ],
  electrical: {
    kind: "ac-dc-power-supply",
    ratedInputVoltageMin: 100,
    ratedInputVoltageMax: 240,
    allowableInputVoltageMin: 85,
    allowableInputVoltageMax: 265,
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
