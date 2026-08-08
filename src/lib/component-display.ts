import type { ComponentCategory, ComponentDefinition } from "@/circuit/types";

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
