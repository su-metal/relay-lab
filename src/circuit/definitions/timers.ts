/**
 * タイマーリレーの定義（design.md §4.10 / §5.13）。
 *
 * 実型番を持たない汎用部品。端子ラベルは "1"〜"5" とする。
 *
 * **電気的には `kind: "relay"`。** タイマーリレーはリレーであって別種の部品では
 * なく、`delay` を持つかどうかだけが違う（design.md §3.2）。エンジンの分岐は
 * 増えず、接点・コイル・端子まわりはリレー用のコードがそのまま効く。
 * `category: "timer"` はパレットの見出しと図記号の出し分けという表示都合だけ。
 *
 * 限時動作（オンディレイ）と限時復帰（オフディレイ）で端子構成は同じなので、
 * 表を 2 回書き写さず `defineTimer()` に寄せる（`switches.ts` と同じ理由）。
 *
 * **実型番（OMRON H3Y-2 など）はここには無い。** 実端子番号を主張するには
 * 公式データシートの図を確認する工程が要る（CLAUDE.md 設計原則 5）。
 * 足すときは `verified: false` から始め、確認できたときだけ `true` にする。
 */

import type { ComponentDefinition } from "@/circuit/types";

import { GENERIC_TERMINAL_SOURCE } from "./source-notes";

/**
 * タイマー共通の見た目サイズ。
 *
 * 型番表示（"オンディレイタイマー（限時動作）"）が 2 行で収まる幅に加え、
 * **シミュレーション中に出る設定時間と残り時間の 2 行ぶん**を高さで確保する。
 * 状態によって出る行で高さを変えると、カウント中に本体が動いて読みにくい
 * （スイッチの操作ボタンで踏んだのと同じ問題・design.md §8.1）。
 */
const TIMER_VISUAL = { width: 190, height: 230 };

/** 設定できる範囲。実機のダイヤルの目盛りに相当する */
const MIN_PRESET_MS = 100;
const MAX_PRESET_MS = 600_000;
const DEFAULT_PRESET_MS = 3_000;

type TimerSpec = {
  id: string;
  model: string;
  mode: "on-delay" | "off-delay";
  /** 接点が動くタイミングの説明。図記号では読み取れないのでここで言い切る */
  contactNote: string;
};

const defineTimer = ({
  id,
  model,
  mode,
  contactNote,
}: TimerSpec): ComponentDefinition => ({
  id,
  model,
  category: "timer",
  terminals: [
    {
      id: "1",
      label: "1",
      role: "coil",
      description: "端子 1 / 入力（コイル）",
      position: { x: 0, y: 0.35 },
      side: "left",
    },
    {
      id: "2",
      label: "2",
      role: "coil",
      description: "端子 2 / 入力（コイル）",
      position: { x: 0, y: 0.65 },
      side: "left",
    },
    {
      id: "3",
      label: "3",
      role: "common",
      contactGroup: "c1",
      description: "端子 3 / 限時接点 COM",
      position: { x: 1, y: 0.5 },
      side: "right",
    },
    {
      id: "4",
      label: "4",
      role: "normally_open",
      contactGroup: "c1",
      description: `端子 4 / 限時 a接点（${contactNote}）`,
      position: { x: 0.65, y: 1 },
      side: "bottom",
    },
    {
      id: "5",
      label: "5",
      role: "normally_closed",
      contactGroup: "c1",
      description: `端子 5 / 限時 b接点（${contactNote}の逆）`,
      position: { x: 0.35, y: 0 },
      side: "top",
    },
  ],
  electrical: {
    kind: "relay",
    relay: {
      coil: {
        voltage: 24,
        currentType: "DC",
        // 汎用タイマーに極性は置かない。実機に無い極性を主張しない
        // （G7L と同じ判断・design.md §4.8）
        positiveTerminal: "1",
        negativeTerminal: "2",
        polarity: "none",
      },
      contacts: [
        {
          id: "c1",
          commonTerminal: "3",
          noTerminal: "4",
          ncTerminal: "5",
          type: "SPDT",
        },
      ],
    },
    delay: {
      mode,
      defaultPresetMs: DEFAULT_PRESET_MS,
      minPresetMs: MIN_PRESET_MS,
      maxPresetMs: MAX_PRESET_MS,
    },
  },
  visual: TIMER_VISUAL,
  source: GENERIC_TERMINAL_SOURCE,
  verified: false,
});

/**
 * オンディレイタイマー（限時動作）。
 *
 * 入力が入ってから**設定時間後に**接点が動く。入力が切れたら即座に戻る。
 * 「起動してから n 秒後に次の動作へ移る」という順序制御の基本形。
 */
export const onDelayTimer = defineTimer({
  id: "timer-on-delay",
  model: "オンディレイタイマー（限時動作）",
  mode: "on-delay",
  contactNote: "入力の設定時間後に閉じる",
});

/**
 * オフディレイタイマー（限時復帰）。
 *
 * 入力と**同時に**接点が動き、入力が切れてから設定時間そのまま保ってから戻る。
 * 「停止してもファンを n 秒回し続ける」のような余熱・遅延停止に使う。
 */
export const offDelayTimer = defineTimer({
  id: "timer-off-delay",
  model: "オフディレイタイマー（限時復帰）",
  mode: "off-delay",
  contactNote: "入力と同時に閉じ、切れて設定時間後に開く",
});
