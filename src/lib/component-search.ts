/**
 * パレットの部品検索（requirements.md Step 7 / requirements_definition.md §6.5）。
 *
 * React を import しない純粋関数なので、UI を起動せずに Vitest で検証できる。
 * **検索対象は型番・メーカー・カテゴリの 3 つ**（＋定義 ID）に限る。
 * 端子番号まで拾うと "14" が MY2N・MY4N・MY4N-D2 のすべてに当たり、
 * 「型番を探す」という検索の目的から外れる。
 */

import { componentDefinitions } from "@/circuit/definitions";
import type { ComponentDefinition } from "@/circuit/types";

import { CATEGORY_LABELS } from "./component-display";

/**
 * 比較用に正規化する。
 *
 * NFKC を掛けているのは日本語 IME 対策。全角のまま確定した "ＭＹ４Ｎ" が
 * "MY4N" に当たらないと、検索窓が動いていないように見える。
 */
const normalize = (value: string): string =>
  value.normalize("NFKC").toLowerCase();

/** 1 部品ぶんの検索対象文字列。カテゴリは日本語表示（"リレー"）でも引ける */
const haystack = (definition: ComponentDefinition): string =>
  normalize(
    [
      definition.model,
      definition.manufacturer ?? "",
      definition.category,
      CATEGORY_LABELS[definition.category],
      definition.id,
    ].join(" "),
  );

/**
 * 部品定義を検索する。
 *
 * 空白で区切った語は **AND**（"omron my2n" で絞り込める）。
 * 空クエリは絞り込まない — 検索窓が空の状態はパレット全件表示そのもの。
 */
export const searchComponentDefinitions = (
  query: string,
  definitions: readonly ComponentDefinition[] = componentDefinitions,
): ComponentDefinition[] => {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [...definitions];

  return definitions.filter((definition) => {
    const target = haystack(definition);
    return tokens.every((token) => target.includes(token));
  });
};
