/**
 * 電磁接触器の定義（design.md §4.12）。
 *
 * **電気的には `kind: "relay"`。** 電磁接触器はコイルで接点を動かす部品であり、
 * リレーと別種ではない。`kind` を分けると接点・コイル・端子まわりの判定が
 * エンジンと adapter の各所で 2 本になり、片方だけ直す事故が起きる
 * （タイマーを `kind: "timer"` にしなかったのと同じ理由・CLAUDE.md 設計原則 7）。
 *
 * リレーとの違いは**接点の構成**だけで、それは `contacts[]` の中身で表せる。
 *
 * - 主接点 3 極 … 負荷を入り切りする a 接点。b 接点は実機に無い
 * - 補助 a 接点 1 個 … 自己保持や表示灯に使う
 * - 補助 b 接点 1 個 … インターロックに使う。**NO 端子が実機に無い**
 *
 * **`category` は "relay" のまま。** パレットの見出しを増やしていないのは、
 * 電磁接触器がリレーの一種として並んで困らないため。タイマーだけ
 * `category: "timer"` を持つのは図記号を出し分けるためで、接触器は
 * リレーと同じ接点の図記号でよい（design.md §3.1）。
 *
 * **実型番はここには無い。** 富士電機 SC / 三菱 S-T / OMRON J7KN などの
 * 実端子番号を主張するには公式カタログの図を確認する工程が要る
 * （CLAUDE.md 設計原則 5）。足すときは `verified: false` から始め、
 * 確認できたときだけ `true` にする。
 */

import type { ComponentDefinition } from "@/circuit/types";

/**
 * 端子記号の出典（design.md §4.12）。
 *
 * **押しボタン（`switches.ts`）と判断が逆になっている。** あちらは IEC 慣例の
 * 13-14 / 11-12 を採らず "1" / "2" にした —— 汎用の押しボタンに標準の
 * 端子記号は無く、13 / 14 は MY4N のコイルと紛らわしいため。
 *
 * 電磁接触器は事情が逆で、**A1 / A2・1/L1〜6/T3・13-14・21-22 は
 * IEC 60947-1（EN 50005）で決まっており、メーカーを問わず実機に刻印
 * されている。** ここで独自の番号を振ると、実機と違う記号を教えることに
 * なる —— MY2N の飛び番を 1〜6 に詰め直さないのと同じ理由（US-F）。
 *
 * ただし**特定型番のカタログとは照合していない**ので `verified: false`。
 * 極数や補助接点の構成は型番ごとに違う。
 */
const CONTACTOR_TERMINAL_SOURCE =
  "IEC 60947-1 / EN 50005 の端子記号（A1・A2 / 1・L1〜6・T3 / 13・14 / 21・22）。汎用部品（実型番なし）で、特定型番のカタログとは未照合";

/**
 * 主接点 1 極ぶんの端子記号。`line` が電源側、`load` が負荷側。
 *
 * **どちらが COM でもない。** 主接点は a 接点で、2 端子は電位の上では対等。
 * 電源側 / 負荷側という区別は盤の配線の慣習であって、電気的な非対称では
 * ない（G7L の 2 端子と同じ扱い・design.md §4.8）。
 */
type MainPole = { line: string; load: string };

/** IEC の主接点記号。奇数が電源側（L）、偶数が負荷側（T） */
const MAIN_POLES: readonly MainPole[] = [
  { line: "1/L1", load: "2/T1" },
  { line: "3/L2", load: "4/T2" },
  { line: "5/L3", load: "6/T3" },
];

/** 補助 a 接点（IEC 60947-1 の 1x 系）。閉じるのは励磁中だけ */
const AUX_NO = { common: "13", no: "14" };

/** 補助 b 接点（IEC 60947-1 の 2x 系）。**NO 端子は実機に無い** */
const AUX_NC = { common: "21", nc: "22" };

/** コイル。交流操作コイルなので極性は無い */
const COIL_A = "A1";
const COIL_B = "A2";

/**
 * 端子の横位置。主接点 3 極を左寄せに固め、補助接点を右へ離す。
 *
 * **主接点と補助接点を等間隔に混ぜない。** 実機は主回路（太い電線）と
 * 制御回路（細い電線）が物理的に分かれており、図でも分けて置かないと
 * 「どれが負荷側の線か」が読めなくなる。
 */
const MAIN_X = [0.12, 0.26, 0.4] as const;
const AUX_NO_X = 0.63;
const AUX_NC_X = 0.82;

/**
 * 汎用電磁接触器（主接点 3 極 ＋ 補助 1a1b ／ コイル AC100V）。
 *
 * 制御盤でいちばん基本の構成。制御回路（DC24V のリレー）で押した結果を、
 * 主接点で AC100V の負荷へ渡す。
 */
export const genericContactor: ComponentDefinition = {
  id: "contactor-generic-3p-1a1b",
  model: "電磁接触器（3極＋1a1b）",
  category: "relay",
  terminals: [
    // 主接点。電源側を上辺、負荷側を下辺に置く
    ...MAIN_POLES.flatMap((pole, index) => {
      const order = index + 1;
      const x = MAIN_X[index];
      return [
        {
          id: pole.line,
          label: pole.line,
          number: pole.line,
          role: "normally_open" as const,
          contactGroup: `c${order}`,
          description: `端子 ${pole.line} / 第${order}極 主接点（電源側）`,
          position: { x, y: 0 },
          side: "top" as const,
        },
        {
          id: pole.load,
          label: pole.load,
          number: pole.load,
          role: "normally_open" as const,
          contactGroup: `c${order}`,
          description: `端子 ${pole.load} / 第${order}極 主接点（負荷側）`,
          position: { x, y: 1 },
          side: "bottom" as const,
        },
      ];
    }),
    {
      id: AUX_NO.common,
      label: AUX_NO.common,
      number: AUX_NO.common,
      role: "normally_open",
      contactGroup: "c4",
      description: `端子 ${AUX_NO.common} / 補助 a接点`,
      position: { x: AUX_NO_X, y: 0 },
      side: "top",
    },
    {
      id: AUX_NO.no,
      label: AUX_NO.no,
      number: AUX_NO.no,
      role: "normally_open",
      contactGroup: "c4",
      description: `端子 ${AUX_NO.no} / 補助 a接点`,
      position: { x: AUX_NO_X, y: 1 },
      side: "bottom",
    },
    {
      id: AUX_NC.common,
      label: AUX_NC.common,
      number: AUX_NC.common,
      role: "normally_closed",
      contactGroup: "c5",
      description: `端子 ${AUX_NC.common} / 補助 b接点`,
      position: { x: AUX_NC_X, y: 0 },
      side: "top",
    },
    {
      id: AUX_NC.nc,
      label: AUX_NC.nc,
      number: AUX_NC.nc,
      role: "normally_closed",
      contactGroup: "c5",
      description: `端子 ${AUX_NC.nc} / 補助 b接点`,
      position: { x: AUX_NC_X, y: 1 },
      side: "bottom",
    },
    // コイルは左辺。MY / G7L と揃えて、制御回路をどちら側に描くかが
    // 型番次第にならないようにする（design.md §4.8）
    {
      id: COIL_A,
      label: COIL_A,
      number: COIL_A,
      role: "coil",
      description: `端子 ${COIL_A} / 操作コイル AC100V（極性なし）`,
      position: { x: 0, y: 0.35 },
      side: "left",
    },
    {
      id: COIL_B,
      label: COIL_B,
      number: COIL_B,
      role: "coil",
      description: `端子 ${COIL_B} / 操作コイル AC100V（極性なし）`,
      position: { x: 0, y: 0.65 },
      side: "left",
    },
  ],
  electrical: {
    kind: "relay",
    relay: {
      coil: {
        voltage: 100,
        currentType: "AC",
        // 交流操作コイルに極性は無い。`positiveTerminal` /
        // `negativeTerminal` は `RelayDefinition` の形に合わせた割り当てで、
        // `polarity: "none"` なのでどちら向きに繋いでも励磁する（§4.8 と同じ）
        positiveTerminal: COIL_A,
        negativeTerminal: COIL_B,
        polarity: "none",
      },
      contacts: [
        ...MAIN_POLES.map((pole, index) => ({
          id: `c${index + 1}`,
          commonTerminal: pole.line,
          noTerminal: pole.load,
          // 主接点に b 接点は無い。持たせないことで非励磁時にどこにも
          // 閉じなくなる（design.md §5.1）
          type: "SPST-NO" as const,
        })),
        {
          id: "c4",
          commonTerminal: AUX_NO.common,
          noTerminal: AUX_NO.no,
          type: "SPST-NO",
        },
        {
          id: "c5",
          commonTerminal: AUX_NC.common,
          // **`noTerminal` を持たせない。** 21–22 は b 接点で、
          // 対になる a 接点の端子が実機に無い。励磁すると 21 はどこにも
          // 繋がらなくなる（design.md §4.12）
          ncTerminal: AUX_NC.nc,
          type: "SPST-NC",
        },
      ],
    },
  },
  // 12 端子（上辺 5・下辺 5・左辺 2）が重ならず、端子記号（"1/L1" の 4 文字）が
  // 読める幅。主接点と補助接点を離して置くぶん、リレーより横に広い
  visual: { width: 340, height: 220 },
  source: CONTACTOR_TERMINAL_SOURCE,
  verified: false,
};
