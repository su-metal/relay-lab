/**
 * 実機の調光システムの機器（design.md §4.15）。
 *
 * **型番・製造元・製品名は書かない。** 社内で作られた機器で、公開できるのは
 * 挙動と端子番号だけ（ユーザー判断）。呼び名は汎用にし、**端子番号だけを
 * 実機どおりにする** —— 実端子番号を扱えることが本プロダクトの価値なので、
 * そこを伏せると足す意味が無くなる。
 *
 * ここに型番分岐は書かない（CLAUDE.md 設計原則 2）。極性・上下限・カーブは
 * 実機では DIP スイッチと可変抵抗で決めるものなので、定義に焼き付けず
 * インスタンスの `dimmerSettings` が持つ（`DimmerSettings` 参照）。
 */

import type { ComponentDefinition, TerminalDefinition } from "@/circuit/types";

import { INVERTED_0_10V_CURVE } from "./dimming";

/**
 * 端子データの出典（design.md §4.15）。
 *
 * **社内仕様書を一次資料とする。** 公開データシートは存在しないので、
 * 型番の代わりに**資料の版と日付**を残す —— 名前を伏せたせいで後から
 * 再検証できなくなるのを防ぐ（CLAUDE.md 設計原則 5 の趣旨）。
 * 社内資料は改訂されるため、外部品よりむしろ版を残す必要が強い。
 */
const IN_HOUSE_SPEC_SOURCE =
  "社内仕様書（ver.1.1・平成20年3月21日作成）の端子番号表と照合済み。型番・製造元は伏せてある";

const AC_DIMMER_SPEC_SOURCE =
  "社内仕様書（17/05/06 作成）の接続図と仕様表と照合済み。型番・製造元は伏せてある";

/** 端子を等間隔に並べる。位置は端子番号ではなく「何個中の何番目か」から決める */
const spread = (index: number, count: number) => (index + 1) / (count + 1);

// ---------------------------------------------------------------------------
// 調光コントローラ（0–10V 16 回路）
// ---------------------------------------------------------------------------

/** 0–10V 調光信号出力。1–8 がフェーダー、9–16 が照明スイッチ */
const ANALOG_OUT_COUNT = 16;

/** ON/OFF 出力（オープンコレクタ）。24–31 が照明スイッチ、32–39 が機能別 */
const OPEN_COLLECTOR_TERMINALS: readonly { id: string; note: string }[] = [
  { id: "24", note: "照明スイッチ 1 ON/OFF 出力" },
  { id: "25", note: "照明スイッチ 2 ON/OFF 出力" },
  { id: "26", note: "照明スイッチ 3 ON/OFF 出力" },
  { id: "27", note: "照明スイッチ 4 ON/OFF 出力" },
  { id: "28", note: "照明スイッチ 5 ON/OFF 出力" },
  { id: "29", note: "照明スイッチ 6 ON/OFF 出力" },
  { id: "30", note: "照明スイッチ 7 ON/OFF 出力" },
  { id: "31", note: "照明スイッチ 8 ON/OFF 出力" },
  { id: "32", note: "電源 ON/OFF 出力" },
  { id: "33", note: "補助ランプ ON/OFF 出力" },
  { id: "34", note: "昇降 上昇 出力" },
  { id: "35", note: "昇降 停止 出力" },
  { id: "36", note: "昇降 下降 出力" },
  { id: "37", note: "AUX2 ON/OFF 出力" },
  { id: "38", note: "電源制御 ノーマルオープン" },
  { id: "39", note: "電源制御 ノーマルクローズ" },
];

/** GND。**機器の中で繋がっている**ので、どれに繋いでも同じ基準になる */
const CONTROLLER_GND = ["21", "44", "45", "46"] as const;

const controllerTerminals = (): TerminalDefinition[] => {
  const terminals: TerminalDefinition[] = [];

  // 0–10V 出力 1–16。上辺
  for (let i = 0; i < ANALOG_OUT_COUNT; i += 1) {
    const id = String(i + 1);
    const isFader = i < 8;
    terminals.push({
      id,
      label: id,
      number: id,
      role: "analog_signal",
      description: `端子 ${id} / ${
        isFader ? `フェーダー ${i + 1}` : `照明スイッチ ${i - 7}`
      } 調光信号出力（0–10V）`,
      position: { x: spread(i, ANALOG_OUT_COUNT), y: 0 },
      side: "top",
      // 使う回路だけ繋ぐ機器。16 回路すべての未接続を指摘すると、
      // 本当に挿し忘れている 1 本が埋もれる（§3.1 の `optional`）
      optional: true,
    });
  }

  // ON/OFF 出力 24–39。下辺
  OPEN_COLLECTOR_TERMINALS.forEach((entry, index) => {
    terminals.push({
      id: entry.id,
      label: entry.id,
      number: entry.id,
      role: "generic",
      description: `端子 ${entry.id} / ${entry.note}（オープンコレクタ）`,
      position: {
        x: spread(index, OPEN_COLLECTOR_TERMINALS.length),
        y: 1,
      },
      side: "bottom",
      optional: true,
    });
  });

  // GND。左辺
  CONTROLLER_GND.forEach((id, index) => {
    terminals.push({
      id,
      label: id,
      number: id,
      role: "analog_common",
      description: `端子 ${id} / GND（調光信号の基準。機器の中で 21・44・45・46 は繋がっている）`,
      position: { x: 0, y: spread(index, CONTROLLER_GND.length) },
      side: "left",
      optional: true,
    });
  });

  // 未接続・通信・フォトカプラ・還流ダイオード。右辺
  const rightSide: { id: string; note: string; role: "generic" }[] = [
    { id: "17", note: "未接続（No Connect）", role: "generic" },
    { id: "18", note: "未接続（No Connect）", role: "generic" },
    { id: "19", note: "未接続（No Connect）", role: "generic" },
    { id: "20", note: "未接続（No Connect）", role: "generic" },
    { id: "22", note: "通信線 ＋", role: "generic" },
    { id: "23", note: "通信線 −", role: "generic" },
    { id: "40", note: "端子 24〜31 の還流ダイオード", role: "generic" },
    { id: "41", note: "端子 32〜39 の還流ダイオード", role: "generic" },
    { id: "42", note: "フォトカプラ入力 ＋（DC12〜24V）", role: "generic" },
    { id: "43", note: "フォトカプラ入力 −（0V）", role: "generic" },
  ];
  rightSide.forEach((entry, index) => {
    terminals.push({
      id: entry.id,
      label: entry.id,
      number: entry.id,
      role: entry.role,
      description: `端子 ${entry.id} / ${entry.note}`,
      position: { x: 1, y: spread(index, rightSide.length) },
      side: "right",
      optional: true,
    });
  });

  return terminals;
};

/**
 * 調光コントローラ（0–10V 16 回路）。
 *
 * **ON/OFF 出力（24–39）は端子として出すが、まだ接点としては働かない。**
 * オープンコレクタは「動作したら GND へ落とす」接点で、アナログ量から
 * 接点を動かす仕組みが要る。次スコープで繋ぐ（requirements.md 含まないもの）。
 *
 * **通信線（22・23）も端子だけ。** 「電位がどこまで届くか」で判定する
 * このエンジンでは、通信の中身に意味が出ない（design.md §6）。
 */
export const dimmingController16ch: ComponentDefinition = {
  id: "dimming-controller-16ch",
  model: "調光コントローラ（0–10V 16回路）",
  category: "dimmer",
  terminals: controllerTerminals(),
  electrical: {
    kind: "analog-source",
    channels: Array.from({ length: ANALOG_OUT_COUNT }, (_, i) => {
      const id = String(i + 1);
      return {
        id,
        signalTerminal: id,
        label: i < 8 ? `フェーダー ${i + 1}` : `照明スイッチ ${i - 7}`,
      };
    }),
    commonTerminals: [...CONTROLLER_GND],
    minVolts: 0,
    maxVolts: 10,
    /**
     * 既定は 10V。
     *
     * **仕様書の「消灯時 10V、点灯時 0V」に合わせてある。** 逆特性の盤では
     * 10V が消灯なので、置いた直後は消えている状態から始まる。0V を既定に
     * すると、繋いだ瞬間に全回路が全灯して、どの回路を操作したのかが
     * 画面から読めない。
     */
    defaultVolts: 10,
  },
  // 上辺 16・下辺 16 の端子番号が重ならない幅。実機どおり横長
  visual: { width: 760, height: 260 },
  source: IN_HOUSE_SPEC_SOURCE,
  verified: true,
};

// ---------------------------------------------------------------------------
// 位相制御調光器
// ---------------------------------------------------------------------------

/**
 * 位相制御調光器（AC100V）。
 *
 * **自分は点らない。通した先を暗くする通り道。** AC 入力をそのまま出力へ
 * 渡し（IN ⇄ OUT は常時導通）、その出力回路に載っているランプの明るさを
 * 調光信号で決める。だから `litLamps` にも入らず、両端の電位差も見ない。
 *
 * 遮断（OFF を GND へ落とす）と DIRECT は**レベルで表す。** 出力段を開く
 * モデルにすると、アナログ量がネットの形を動かして収束ループへ入り込み、
 * 「アナログは第 2 パス」という前提が崩れる（design.md §5.17）。
 *
 * 極性の反転・調光上限（100/90/80/70%）・調光下限（0〜50%）・カーブの形
 * （リニヤー / 2 乗特性）は実機の DIP と可変抵抗にあたるので、定義ではなく
 * インスタンスの `dimmerSettings` が持つ。
 */
export const phaseControlDimmer: ComponentDefinition = {
  id: "dimmer-phase-control-ac100v",
  model: "位相制御調光器（AC100V）",
  category: "dimmer",
  terminals: [
    {
      id: "IN",
      label: "IN",
      number: "IN",
      role: "power_line",
      description: "IN / AC100V 入力",
      position: { x: 0.2, y: 0 },
      side: "top",
    },
    {
      id: "COM",
      label: "COM",
      number: "COM",
      role: "power_neutral",
      description: "COM / AC のコモン",
      position: { x: 0.5, y: 0 },
      side: "top",
    },
    {
      id: "OUT",
      label: "OUT",
      number: "OUT",
      role: "power_line",
      description: "OUT / AC 調光出力（この回路の負荷が調光される）",
      position: { x: 0.8, y: 0 },
      side: "top",
    },
    {
      id: "CN",
      label: "CN",
      number: "CN",
      role: "analog_signal",
      description: "CN / 調光信号 0–10V（入力抵抗 22kΩ）",
      position: { x: 0.2, y: 1 },
      side: "bottom",
    },
    {
      id: "GND",
      label: "GND",
      number: "GND",
      role: "analog_common",
      description: "GND / 調光信号の基準",
      position: { x: 0.5, y: 1 },
      side: "bottom",
    },
    {
      id: "OFF",
      label: "OFF",
      number: "OFF",
      role: "generic",
      description: "OFF / GND へ落とすと出力を遮断する",
      position: { x: 0.8, y: 1 },
      side: "bottom",
      // 遮断を使わない盤では繋がないのが普通。**CN と GND は optional に
      // しない** —— あちらは挿し忘れると（逆特性では）全灯する端子で、
      // 指摘されないと気付けない
      optional: true,
    },
  ],
  electrical: {
    kind: "dimmer",
    inTerminal: "IN",
    outTerminal: "OUT",
    acCommonTerminal: "COM",
    signalTerminal: "CN",
    signalCommonTerminal: "GND",
    cutoffTerminal: "OFF",
    curve: INVERTED_0_10V_CURVE,
    /**
     * 未接続時は 0V 相当（入力段のプルダウン）。
     *
     * この盤の逆特性では **100%（全灯）**になる。実機の入力回路次第の値
     * なのでエンジンには持たせない（CLAUDE.md 設計原則 9）。
     */
    unconnectedVolts: 0,
  },
  // 上辺 3・下辺 3 の端子と、本体に出す明るさ（"0.0V ／ 100%"）が収まる幅
  visual: { width: 260, height: 190 },
  source: AC_DIMMER_SPEC_SOURCE,
  verified: true,
};
