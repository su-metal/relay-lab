/**
 * OMRON MY4N DC24V — 14 ピン（ソケット PYF14A 系）。design.md §4.1。
 *
 * 端子番号は Web 調査による仮置きで **未検証**（`verified: false`）。
 * 実機／公式データシートで確認できたら `verified: true` に更新し、
 * design.md §4.4 の確度表も同時に直すこと。
 */

import type { ComponentDefinition, TerminalDefinition } from "@/circuit/types";

const SOURCE = "https://www.relayspec.com/specs/099/MY.pdf";

/**
 * design.md §4.1 の端子表をそのまま写したもの。
 * NC = b 接点 / NO = a 接点 / COM = コモン。
 */
const CONTACT_TABLE = [
  { id: "c1", order: 1, nc: "1", no: "5", com: "9" },
  { id: "c2", order: 2, nc: "2", no: "6", com: "10" },
  { id: "c3", order: 3, nc: "3", no: "7", com: "11" },
  { id: "c4", order: 4, nc: "4", no: "8", com: "12" },
] as const;

/**
 * 画面配置。実ソケットの物理ピン配置は模さない。
 * 「上が NC / 下が NO / 右が COM / 左がコイル」で揃え、
 * 端子番号が読み取りやすいことを優先する（design.md §8）。
 */
const contactX = (order: number) => order * 0.2;
const comY = (order: number) => order * 0.2;

const contactTerminals: TerminalDefinition[] = [
  ...CONTACT_TABLE.map<TerminalDefinition>((c) => ({
    id: c.nc,
    label: c.nc,
    number: c.nc,
    role: "normally_closed",
    contactGroup: c.id,
    description: `端子 ${c.nc} / 第${c.order}接点 NC（b接点）`,
    position: { x: contactX(c.order), y: 0 },
    side: "top",
  })),
  ...CONTACT_TABLE.map<TerminalDefinition>((c) => ({
    id: c.no,
    label: c.no,
    number: c.no,
    role: "normally_open",
    contactGroup: c.id,
    description: `端子 ${c.no} / 第${c.order}接点 NO（a接点）`,
    position: { x: contactX(c.order), y: 1 },
    side: "bottom",
  })),
  ...CONTACT_TABLE.map<TerminalDefinition>((c) => ({
    id: c.com,
    label: c.com,
    number: c.com,
    role: "common",
    contactGroup: c.id,
    description: `端子 ${c.com} / 第${c.order}接点 COM`,
    position: { x: 1, y: comY(c.order) },
    side: "right",
  })),
];

const coilTerminals: TerminalDefinition[] = [
  {
    id: "13",
    label: "13",
    number: "13",
    role: "coil_negative",
    description: "端子 13 / コイル − / DC24V",
    position: { x: 0, y: 0.65 },
    side: "left",
  },
  {
    id: "14",
    label: "14",
    number: "14",
    role: "coil_positive",
    description: "端子 14 / コイル + / DC24V",
    position: { x: 0, y: 0.35 },
    side: "left",
  },
];

export const omronMy4nDc24: ComponentDefinition = {
  id: "omron-my4n-dc24",
  manufacturer: "OMRON",
  model: "MY4N",
  category: "relay",
  terminals: [...contactTerminals, ...coilTerminals].sort(
    (a, b) => Number(a.id) - Number(b.id),
  ),
  electrical: {
    kind: "relay",
    relay: {
      coil: {
        voltage: 24,
        currentType: "DC",
        positiveTerminal: "14",
        negativeTerminal: "13",
        // 「N」は表示 LED 付きの意。コイル自体は無極性で逆接でも励磁するが、
        // 表示 LED が点灯しない、という理解（design.md §4.4「要検証」）。
        // 内蔵ダイオード付きの MY4N-D2 は "strict" になる（Step 7）。
        polarity: "indicator",
      },
      contacts: CONTACT_TABLE.map((c) => ({
        id: c.id,
        commonTerminal: c.com,
        noTerminal: c.no,
        ncTerminal: c.nc,
        type: "SPDT",
      })),
    },
  },
  visual: { width: 260, height: 220 },
  source: SOURCE,
  verified: false,
};
