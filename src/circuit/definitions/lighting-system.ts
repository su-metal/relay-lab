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

const PC_CONTROLLER_SPEC_SOURCE =
  "社内仕様書（02.4.9 作成）の接続図と仕様表と照合済み。型番・製造元は伏せてある";

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

// ---------------------------------------------------------------------------
// ライトコントローラ（4 回路・カットリレー付き）
// ---------------------------------------------------------------------------

const LIGHT_CONTROLLER_CHANNELS = 4;

/**
 * ライトコントローラ（4 回路・DC24V）。
 *
 * 0–10V の調光信号を受け、**明るさが動作点を下回るとカットリレーが動作する。**
 * 実機は受けた信号を PWM へ変換して出すが、**波形は扱わない**（design.md §6）
 * —— この盤で読みたいのは「絞ったらリレーが落ちる」という連動のほうなので、
 * PWM 出力は端子として出すだけにしてある。
 *
 * **コイルを持たない。** カットリレーの接点はコイルではなくアナログ量で
 * 動く。実機に無いコイル端子を作って埋めない（CLAUDE.md 設計原則 6）。
 *
 * 動作点は実機の CUT ADJ.（回路ごとのつまみ）にあたり、インスタンスの
 * `triggerPercents` が持つ。4 回路それぞれ別の動作点に設定できる。
 */
export const lightController4ch: ComponentDefinition = {
  id: "light-controller-4ch",
  model: "ライトコントローラ（4回路）",
  /*
   * **電気的にはリレーだが、カテゴリは調光。**
   *
   * パレットは電気的な分類ではなく**探す場所**。MY4N を探している人の
   * リレー一覧に調光の機器が混ざると、リレー回路だけを組みたい人の
   * 邪魔になる。`kind` は `relay` のままなので、エンジンから見た扱いは
   * 何も変わらない（`category` は表示都合だけ・design.md §3.1）。
   */
  category: "dimmer",
  terminals: [
    // 調光信号入力 1–4 ＋ コモン。上辺
    ...Array.from({ length: LIGHT_CONTROLLER_CHANNELS }, (_, i) => {
      const id = `IN${i + 1}`;
      return {
        id,
        label: String(i + 1),
        number: String(i + 1),
        role: "analog_signal" as const,
        description: `INPUT ${i + 1} / 調光信号入力（0–10V）`,
        position: { x: (i + 1) / (LIGHT_CONTROLLER_CHANNELS + 2), y: 0 },
        side: "top" as const,
      };
    }),
    {
      id: "ING",
      label: "G",
      number: "G",
      role: "analog_common",
      description: "INPUT G / 調光信号の基準",
      position: {
        x: (LIGHT_CONTROLLER_CHANNELS + 1) / (LIGHT_CONTROLLER_CHANNELS + 2),
        y: 0,
      },
      side: "top",
    },
    // カットリレー接点 1–4 ＋ コモン。下辺
    ...Array.from({ length: LIGHT_CONTROLLER_CHANNELS }, (_, i) => {
      const id = `CR${i + 1}`;
      return {
        id,
        label: String(i + 1),
        number: String(i + 1),
        role: "normally_open" as const,
        contactGroup: `c${i + 1}`,
        description: `CUT RELAY ${i + 1} / カットリレー接点（第${i + 1}回路）`,
        position: { x: (i + 1) / (LIGHT_CONTROLLER_CHANNELS + 2), y: 1 },
        side: "bottom" as const,
      };
    }),
    {
      id: "CRG",
      label: "G",
      number: "G",
      role: "common",
      description: "CUT RELAY G / カットリレー接点のコモン（4 回路共通）",
      position: {
        x: (LIGHT_CONTROLLER_CHANNELS + 1) / (LIGHT_CONTROLLER_CHANNELS + 2),
        y: 1,
      },
      side: "bottom",
    },
    // PWM 出力。右辺。波形は扱わないので端子だけ
    ...Array.from({ length: LIGHT_CONTROLLER_CHANNELS }, (_, i) => ({
      id: `OUT${i + 1}`,
      label: `${i + 1}`,
      number: `${i + 1}`,
      role: "generic" as const,
      description: `出力 ${i + 1} / PWM 出力（波形は扱わない）`,
      position: { x: 1, y: (i + 1) / (LIGHT_CONTROLLER_CHANNELS + 1) },
      side: "right" as const,
      optional: true,
    })),
    // 電源。左辺
    {
      id: "24V",
      label: "24V",
      number: "24V",
      role: "power_positive",
      description: "24V / 電源 DC24V",
      position: { x: 0, y: 0.35 },
      side: "left",
    },
    {
      id: "GND",
      label: "GND",
      number: "GND",
      role: "power_zero",
      description: "GND / 電源 0V",
      position: { x: 0, y: 0.65 },
      side: "left",
    },
  ],
  electrical: {
    kind: "relay",
    relay: {
      // **コイルは持たない。** 接点はアナログ量で動く（design.md §4.16）
      analogInputs: Array.from(
        { length: LIGHT_CONTROLLER_CHANNELS },
        (_, i) => ({
          id: `in${i + 1}`,
          signalTerminal: `IN${i + 1}`,
          commonTerminal: "ING",
          curve: INVERTED_0_10V_CURVE,
          // 入力段はプルダウン。逆特性のこの盤では未接続＝100%（全灯）
          unconnectedVolts: 0,
        }),
      ),
      contacts: Array.from({ length: LIGHT_CONTROLLER_CHANNELS }, (_, i) => ({
        id: `c${i + 1}`,
        commonTerminal: "CRG",
        noTerminal: `CR${i + 1}`,
        // b 接点は実機に無い。a 接点のみ（G7L と同じ形）
        type: "SPST-NO" as const,
        trigger: {
          inputId: `in${i + 1}`,
          // 仕様書の「0〜50% で動作（調整可）」。既定は中ほどに置く
          defaultBelowPercent: 25,
          minPercent: 0,
          maxPercent: 50,
        },
      })),
    },
  },
  // 上辺 5・下辺 5・左右に端子が出るぶんの幅
  visual: { width: 340, height: 230 },
  source: PC_CONTROLLER_SPEC_SOURCE,
  verified: true,
};

// ---------------------------------------------------------------------------
// 調光操作卓
// ---------------------------------------------------------------------------

/**
 * 調光操作卓（15 端子・AC100V）。
 *
 * 8 フェーダー・8 シーン記憶を持つ操作卓だが、**このシミュレーターが扱うのは
 * 端子に出てくるものだけ。** シーンの記憶やフェーダーの操作は機器の中の話で、
 * 配線からは読めない（design.md §6）。
 *
 * 端子として意味を持つのは電源の状態に連動する接点で、2 種類ある。
 *
 * - **無電圧接点**（4-5-6）… COM が NC / NO のどちらかへ倒れる c 接点
 * - **オープンコレクタ出力**（2・3）… 動作すると GND へ落ちる。
 *   GND（9）をコモンにした c 接点として表す —— 実機で「落とす」先が
 *   GND なのだから、コモンに GND を置くのがいちばん実機に近い
 *
 * **コイルを持たない。** 接点を動かすのは人が押す電源ボタンで、
 * これは `operations` として持つ。倒した状態は保存しない（§4.7 と同じ）。
 */
export const dimmingConsole: ComponentDefinition = {
  id: "dimming-console",
  model: "調光操作卓",
  // 人が倒す機器だが、探す場所は調光（`lightController4ch` と同じ理由）
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
      role: "power_line",
      description: "端子 14 / AC100V（L）",
      position: { x: 0.8, y: 1 },
      side: "bottom",
    },
    {
      id: "15",
      label: "15",
      number: "15",
      role: "power_neutral",
      description: "端子 15 / AC100V（N）",
      position: { x: 0.93, y: 1 },
      side: "bottom",
    },
  ],
  electrical: {
    kind: "relay",
    relay: {
      // **コイルは持たない。** 接点を動かすのは人が押す電源ボタン
      operations: [{ id: "power", label: "電源" }],
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
          // オープンコレクタ出力。落とす先が GND なので GND をコモンに置く
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
  visual: { width: 250, height: 260 },
  source: IN_HOUSE_SPEC_SOURCE,
  verified: true,
};
