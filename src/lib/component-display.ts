import type { WireState } from "@/circuit/adapter/simulation-view";
import type {
  CoilPolarity,
  ComponentCategory,
  ComponentDefinition,
  TerminalRole,
} from "@/circuit/types";

/** カテゴリの日本語表示。パレットの見出しとプロパティパネルで共用する */
export const CATEGORY_LABELS: Record<ComponentCategory, string> = {
  power: "電源",
  switch: "スイッチ",
  relay: "リレー",
  lamp: "ランプ",
  diode: "ダイオード",
  terminal: "端子台",
};

/** パレットに並べる順序。`componentDefinitions` の並びより優先する */
export const CATEGORY_ORDER: readonly ComponentCategory[] = [
  "power",
  "switch",
  "relay",
  "lamp",
  "diode",
  "terminal",
];

/**
 * 実端子番号を持つ部品か（`TerminalDefinition.number` の有無）。
 *
 * 「未検証」バッジの出し分けに使う。汎用部品（電源 / 押しボタン / ランプ）は
 * 実端子番号を持たないので `verified: false` ではあっても
 * **検証対象そのものが存在しない**（design.md §4.4 / §4.5）。
 * そこへ「未検証」と出すと、実型番の未検証バッジの意味が薄れる。
 */
export const hasRealTerminalNumbers = (
  definition: ComponentDefinition,
): boolean =>
  definition.terminals.some((terminal) => terminal.number !== undefined);

/** 端子の役割の日本語表示。プロパティパネルの端子一覧で使う */
export const TERMINAL_ROLE_LABELS: Record<TerminalRole, string> = {
  power_positive: "電源 +",
  power_zero: "電源 0V",
  coil_positive: "コイル +",
  coil_negative: "コイル −",
  common: "COM",
  normally_open: "NO（a接点）",
  normally_closed: "NC（b接点）",
  anode: "アノード",
  cathode: "カソード",
  generic: "端子",
};

/**
 * コイルの極性の表示（design.md §5.3）。
 *
 * 「極性あり / なし」の 2 値に丸めない。MY4N（逆接でも励磁する）と
 * MY4N-D2（逆接では励磁しない）の差はまさにここにあり、
 * それを読み取れることがプロダクトの価値そのものだから。
 */
export const COIL_POLARITY_LABELS: Record<CoilPolarity, string> = {
  none: "極性なし",
  indicator: "極性あり（表示灯）",
  strict: "極性厳守",
};

/** 極性の意味の補足。パネルで 1 行添える */
export const COIL_POLARITY_NOTES: Record<CoilPolarity, string> = {
  none: "どちら向きに繋いでも励磁します。",
  indicator: "逆接でも励磁しますが、表示灯が点灯しません。",
  strict: "逆接では励磁しません（内蔵ダイオードが順方向）。",
};

/** 端子・配線の電位状態の日本語表示（design.md §5.6） */
export const WIRE_STATE_LABELS: Record<WireState, string> = {
  inactive: "非通電",
  plus: "+ 側",
  zero: "0V 側",
  energized: "通電中",
  short: "短絡",
};
