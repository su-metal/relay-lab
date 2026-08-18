"use client";

/**
 * 部品パレット（左カラム）。
 *
 * 一覧はレジストリから生成する。Step 7 で MY2N / MY4N-D2 / 端子台 /
 * ダイオードを足したが、このファイルの一覧生成は変わっていない
 * （増えたのは検索窓だけ）。
 */

import { useMemo, useState } from "react";
import type { DragEvent } from "react";

import type { ComponentCategory, ComponentDefinition } from "@/circuit/types";
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  hasRealTerminalNumbers,
} from "@/lib/component-display";
import { searchComponentDefinitions } from "@/lib/component-search";

import { PALETTE_DND_MIME } from "./palette-dnd";
import styles from "./ComponentPalette.module.css";

type Group = { category: ComponentCategory; items: ComponentDefinition[] };

/** カテゴリ順に並べ替えたグループ。該当が無いカテゴリは出さない */
const groupByCategory = (definitions: ComponentDefinition[]): Group[] =>
  CATEGORY_ORDER.map((category) => ({
    category,
    items: definitions.filter((definition) => definition.category === category),
  })).filter((group) => group.items.length > 0);

const handleDragStart =
  (definitionId: string) => (event: DragEvent<HTMLElement>) => {
    event.dataTransfer.setData(PALETTE_DND_MIME, definitionId);
    event.dataTransfer.setData("text/plain", definitionId);
    event.dataTransfer.effectAllowed = "copy";
  };

export type ComponentPaletteProps = {
  /**
   * タップで置く経路（design.md §8.12）。指の端末には HTML5 の D&D が無いので、
   * **渡されたときはドラッグではなくタップで置く一覧に切り替える。**
   * 置き場所（いま見えている範囲の中央）は呼び出し側が決める。
   */
  onPick?: (definition: ComponentDefinition) => void;
};

export function ComponentPalette({ onPick }: ComponentPaletteProps = {}) {
  const [query, setQuery] = useState("");

  // 絞り込みは `searchComponentDefinitions()` に閉じる。
  // ここに判定を書くと UI を起動しないと検索を検証できなくなる
  const groups = useMemo(
    () => groupByCategory(searchComponentDefinitions(query)),
    [query],
  );

  const matched = groups.reduce((sum, group) => sum + group.items.length, 0);

  return (
    <aside className={styles.palette} aria-label="部品パレット">
      <h2 className={styles.title}>部品</h2>
      <p className={styles.hint}>
        {onPick
          ? "タップするとキャンバスの中央に置きます。"
          : "キャンバスへドラッグして配置します。"}
      </p>

      <div className={styles.search}>
        <input
          className={styles.searchInput}
          type="search"
          value={query}
          placeholder="型番・メーカー・カテゴリ"
          aria-label="部品を検索"
          onChange={(event) => setQuery(event.target.value)}
        />
        {query && (
          <button
            type="button"
            className={styles.searchClear}
            aria-label="検索条件を消す"
            onClick={() => setQuery("")}
          >
            ×
          </button>
        )}
      </div>

      {query && (
        <p className={styles.searchCount} role="status">
          {matched} 件
        </p>
      )}

      {groups.length === 0 ? (
        <p className={styles.empty}>
          「{query}」に一致する部品はありません。
        </p>
      ) : (
        groups.map((group) => (
          <section key={group.category} className={styles.group}>
            <h3 className={styles.groupTitle}>
              {CATEGORY_LABELS[group.category]}
            </h3>
            <ul className={styles.list}>
              {group.items.map((definition) => (
                <li key={definition.id}>
                  {/*
                    置き方は 2 通り（design.md §8.12）。ドラッグできる環境では
                    掴める `<div>`、指の端末では押せる `<button>`。
                    **指のときに draggable な要素を出さない** —— 掴めるように
                    見えて実際には動かないので、置けないと誤解される
                  */}
                  {onPick ? (
                    <button
                      type="button"
                      className={`${styles.item} ${styles.tapItem}`}
                      onClick={() => onPick(definition)}
                      title={definition.source}
                    >
                      <ItemContent definition={definition} />
                    </button>
                  ) : (
                    <div
                      className={styles.item}
                      draggable
                      onDragStart={handleDragStart(definition.id)}
                      title={definition.source}
                    >
                      <ItemContent definition={definition} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </aside>
  );
}

/** 一覧 1 行の中身。掴む `<div>` と押す `<button>` で同じものを出す */
function ItemContent({ definition }: { definition: ComponentDefinition }) {
  return (
    <>
      <span className={styles.itemName}>
        {definition.manufacturer && (
          <span className={styles.manufacturer}>
            {definition.manufacturer}{" "}
          </span>
        )}
        {definition.model}
      </span>
      <span className={styles.itemMeta}>
        {definition.terminals.length} 端子
        {/*
          実端子番号を持つ型番だけが「未検証」の対象。
          汎用部品は実端子番号そのものが無い（design.md §4.4 / §4.5）
        */}
        {hasRealTerminalNumbers(definition) ? (
          !definition.verified && (
            <span className={styles.unverified}>未検証</span>
          )
        ) : (
          <span className={styles.generic}>実端子番号なし</span>
        )}
      </span>
    </>
  );
}
