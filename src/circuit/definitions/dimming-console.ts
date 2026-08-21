import type { ComponentDefinition } from "@/circuit/types";

/**
 * 新型の調光操作卓。
 *
 * 旧型の AC100V 給電ではなく、端子 14 / 15 から DC12V で動作する仕様。
 * 8 フェーダー・8 シーン記憶を持つが、シミュレーターでは端子に現れる接点・
 * 通信と操作子だけを扱う。
 *
 * 電源仕様はユーザーが新型の社内仕様書で確認済み。型番・製造元は公開しない。
 */
const DIMMING_CONSOLE_SPEC_SOURCE =
  "社内仕様書（新型・DC12V電源仕様をユーザー確認済み）。型番・製造元は伏せてある";

export const dimmingConsole: ComponentDefinition = {
  id: "dimming-console",
  model: "調光操作卓",
  category: "dimmer",
  terminals: [
    {
      id: "1",
      label: "1",
      number: "1",
      role: "power_positive",
      description: "端子 1 / ＋12V 出力（100mA）",
      position: { x: 1, y: 0.12 },
      side: "right",
      optional: true,
    },
    {
      id: "2",
      label: "2",
      number: "2",
      role: "normally_open",
      contactGroup: "c2",
      description: "端子 2 / AUX1 オープンコレクタ出力（電源 ノーマルオープン）",
      position: { x: 1, y: 0.32 },
      side: "right",
    },
    {
      id: "3",
      label: "3",
      number: "3",
      role: "normally_closed",
      contactGroup: "c2",
      description: "端子 3 / AUX2 オープンコレクタ出力（電源 ノーマルクローズ）",
      position: { x: 1, y: 0.52 },
      side: "right",
    },
    {
      id: "4",
      label: "4",
      number: "4",
      role: "normally_closed",
      contactGroup: "c1",
      description: "端子 4 / 電源 ノーマルクローズ（無電圧接点）",
      position: { x: 0, y: 0.2 },
      side: "left",
    },
    {
      id: "5",
      label: "5",
      number: "5",
      role: "common",
      contactGroup: "c1",
      description: "端子 5 / 電源 コモン（無電圧接点）",
      position: { x: 0, y: 0.4 },
      side: "left",
    },
    {
      id: "6",
      label: "6",
      number: "6",
      role: "normally_open",
      contactGroup: "c1",
      description: "端子 6 / 電源 ノーマルオープン（無電圧接点）",
      position: { x: 0, y: 0.6 },
      side: "left",
    },
    {
      id: "7",
      label: "7",
      number: "7",
      role: "generic",
      description: "端子 7 / 通信線 ＋",
      position: { x: 1, y: 0.72 },
      side: "right",
      optional: true,
    },
    {
      id: "8",
      label: "8",
      number: "8",
      role: "generic",
      description: "端子 8 / 通信線 −",
      position: { x: 1, y: 0.88 },
      side: "right",
      optional: true,
    },
    {
      id: "9",
      label: "9",
      number: "9",
      role: "power_zero",
      description: "端子 9 / GND（オープンコレクタ出力のコモン）",
      position: { x: 0, y: 0.8 },
      side: "left",
    },
    {
      id: "10",
      label: "10",
      number: "10",
      role: "generic",
      description: "端子 10 / フォトカプラ入力 ＋（DC12〜24V）",
      position: { x: 0.2, y: 1 },
      side: "bottom",
      optional: true,
    },
    {
      id: "11",
      label: "11",
      number: "11",
      role: "generic",
      description: "端子 11 / フォトカプラ入力 −（0V）",
      position: { x: 0.35, y: 1 },
      side: "bottom",
      optional: true,
    },
    {
      id: "12",
      label: "12",
      number: "12",
      role: "power_zero",
      description: "端子 12 / GND",
      position: { x: 0.5, y: 1 },
      side: "bottom",
      optional: true,
    },
    {
      id: "13",
      label: "13",
      number: "13",
      role: "generic",
      description: "端子 13 / FG（接地）",
      position: { x: 0.65, y: 1 },
      side: "bottom",
      optional: true,
    },
    {
      id: "14",
      label: "14",
      number: "14",
      role: "power_positive",
      description: "端子 14 / DC12V（＋）入力",
      position: { x: 0.8, y: 1 },
      side: "bottom",
    },
    {
      id: "15",
      label: "15",
      number: "15",
      role: "power_zero",
      description: "端子 15 / DC12V（0V）入力",
      position: { x: 0.93, y: 1 },
      side: "bottom",
    },
  ],
  electrical: {
    kind: "relay",
    relay: {
      operations: [
        { id: "power", label: "電源" },
        ...Array.from({ length: 8 }, (_, i) => ({
          id: `fader${i + 1}`,
          label: `フェーダー ${i + 1}`,
          kind: "level" as const,
          defaultPercent: 0,
        })),
        ...Array.from({ length: 8 }, (_, i) => ({
          id: `light${i + 1}`,
          label: `照明 ${i + 1}`,
        })),
      ],
      contacts: [
        {
          id: "c1",
          operationId: "power",
          commonTerminal: "5",
          noTerminal: "6",
          ncTerminal: "4",
          type: "SPDT",
        },
        {
          id: "c2",
          operationId: "power",
          commonTerminal: "9",
          noTerminal: "2",
          ncTerminal: "3",
          type: "SPDT",
        },
      ],
    },
  },
  communication: {
    port: {
      plusTerminal: "7",
      minusTerminal: "8",
      commonTerminals: ["9", "12"],
    },
    transmits: [
      ...Array.from({ length: 8 }, (_, i) => `fader${i + 1}`),
      ...Array.from({ length: 8 }, (_, i) => `light${i + 1}`),
    ],
  },
  visual: { width: 320, height: 520 },
  source: DIMMING_CONSOLE_SPEC_SOURCE,
  verified: true,
};
