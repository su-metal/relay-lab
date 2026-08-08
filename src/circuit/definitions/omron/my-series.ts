/**
 * OMRON MY シリーズ共通の端子生成（design.md §4.1〜§4.3）。
 *
 * MY2N / MY4N / MY4N-D2 は端子番号の振り方が同じ系列で、違いは
 * **接点が何回路あるか**と**コイルの極性**の 2 点しかない。
 * 端子表を型番ごとに手で写すと、片方を直してもう片方を直し忘れた瞬間に
 * 「実端子番号が正しい」という本プロダクトの前提が崩れる。
 * そこで §4.1 の表を 1 箇所に置き、各型番はそこから使う行を選ぶだけにする。
 *
 * **ここに型番分岐は書かない。** 型番ごとの差は呼び出し側が渡す引数
 * （接点行・極性・コイルの補足）だけで表現する。
 */

import type { ComponentDefinition, TerminalDefinition } from "@/circuit/types";
import type { CoilPolarity, RelayContact } from "@/circuit/types";

/** MY シリーズのデータシート。全型番の端子データの出典（design.md §4.4） */
export const MY_SERIES_SOURCE = "https://www.relayspec.com/specs/099/MY.pdf";

/** 1 接点ぶんの実端子番号。NC = b 接点 / NO = a 接点 / COM = コモン */
export type MyContactRow = {
  nc: string;
  no: string;
  com: string;
};

/**
 * MY4N（14 ピン）の接点表そのまま（design.md §4.1）。
 * MY2N はこの 1 行目と 4 行目だけを使う（design.md §4.2）。
 */
export const MY4N_CONTACT_ROWS: readonly MyContactRow[] = [
  { nc: "1", no: "5", com: "9" },
  { nc: "2", no: "6", com: "10" },
  { nc: "3", no: "7", com: "11" },
  { nc: "4", no: "8", com: "12" },
];

/**
 * MY2N（8 ピン）の接点表（design.md §4.2）。
 *
 * **端子番号は 1・4・5・8・9・12 の飛び番のまま扱う。**
 * 1〜6 に詰め直すと実機と違う番号を教えることになり、
 * 本プロダクトの価値そのものを損なう。
 */
export const MY2N_CONTACT_ROWS: readonly MyContactRow[] = [
  MY4N_CONTACT_ROWS[0],
  MY4N_CONTACT_ROWS[3],
];

/** コイルは全型番共通で 13 = (−) / 14 = (+) */
const COIL_POSITIVE = "14";
const COIL_NEGATIVE = "13";

/**
 * 接点端子の画面配置。実ソケットの物理ピン配置は模さず、
 * 「上が NC / 下が NO / 右が COM」で揃えて端子番号の可読性を優先する（design.md §8）。
 *
 * 位置は端子番号ではなく **何個中の何番目か** から決める。
 * MY4N（4 接点）では 0.2 / 0.4 / 0.6 / 0.8 となり従来の配置と一致し、
 * MY2N（2 接点）では 1/3 / 2/3 に均等に並ぶ。飛び番を詰めるのは
 * 表示位置だけで、端子番号には一切触れない。
 */
const spread = (index: number, count: number) => (index + 1) / (count + 1);

type MyRelayOptions = {
  id: string;
  model: string;
  contactRows: readonly MyContactRow[];
  polarity: CoilPolarity;
  /** コイル端子の説明に添える補足（"ダイオード内蔵" など）。省略可 */
  coilNote?: string;
  visual: { width: number; height: number };
};

/** 接点行から `RelayContact[]` を組む。接点 ID と回路番号は並び順で振る */
const buildContacts = (rows: readonly MyContactRow[]): RelayContact[] =>
  rows.map((row, index) => ({
    id: `c${index + 1}`,
    commonTerminal: row.com,
    noTerminal: row.no,
    ncTerminal: row.nc,
    type: "SPDT",
  }));

const buildTerminals = (
  rows: readonly MyContactRow[],
  coilNote: string | undefined,
): TerminalDefinition[] => {
  const suffix = coilNote ? `（${coilNote}）` : "";

  const contactTerminals = rows.flatMap<TerminalDefinition>((row, index) => {
    const order = index + 1;
    const along = spread(index, rows.length);
    return [
      {
        id: row.nc,
        label: row.nc,
        number: row.nc,
        role: "normally_closed",
        contactGroup: `c${order}`,
        description: `端子 ${row.nc} / 第${order}接点 NC（b接点）`,
        position: { x: along, y: 0 },
        side: "top",
      },
      {
        id: row.no,
        label: row.no,
        number: row.no,
        role: "normally_open",
        contactGroup: `c${order}`,
        description: `端子 ${row.no} / 第${order}接点 NO（a接点）`,
        position: { x: along, y: 1 },
        side: "bottom",
      },
      {
        id: row.com,
        label: row.com,
        number: row.com,
        role: "common",
        contactGroup: `c${order}`,
        description: `端子 ${row.com} / 第${order}接点 COM`,
        position: { x: 1, y: along },
        side: "right",
      },
    ];
  });

  const coilTerminals: TerminalDefinition[] = [
    {
      id: COIL_NEGATIVE,
      label: COIL_NEGATIVE,
      number: COIL_NEGATIVE,
      role: "coil_negative",
      description: `端子 ${COIL_NEGATIVE} / コイル − / DC24V${suffix}`,
      position: { x: 0, y: 0.65 },
      side: "left",
    },
    {
      id: COIL_POSITIVE,
      label: COIL_POSITIVE,
      number: COIL_POSITIVE,
      role: "coil_positive",
      description: `端子 ${COIL_POSITIVE} / コイル + / DC24V${suffix}`,
      position: { x: 0, y: 0.35 },
      side: "left",
    },
  ];

  // 端子番号の昇順に並べる。プロパティパネルの端子一覧が
  // 飛び番でも実機のピン番号順に読める
  return [...contactTerminals, ...coilTerminals].sort(
    (a, b) => Number(a.id) - Number(b.id),
  );
};

/**
 * MY シリーズの DC24V リレー定義を組み立てる。
 *
 * 端子データは Web 調査による仮置きで **未検証**（`verified: false`）。
 * 実機／公式データシートで確認できたら `verified: true` に更新し、
 * design.md §4.4 の確度表も同時に直すこと（CLAUDE.md 設計原則 5）。
 */
export const defineMyRelay = ({
  id,
  model,
  contactRows,
  polarity,
  coilNote,
  visual,
}: MyRelayOptions): ComponentDefinition => ({
  id,
  manufacturer: "OMRON",
  model,
  category: "relay",
  terminals: buildTerminals(contactRows, coilNote),
  electrical: {
    kind: "relay",
    relay: {
      coil: {
        voltage: 24,
        currentType: "DC",
        positiveTerminal: COIL_POSITIVE,
        negativeTerminal: COIL_NEGATIVE,
        polarity,
      },
      contacts: buildContacts(contactRows),
    },
  },
  visual,
  source: MY_SERIES_SOURCE,
  verified: false,
});
