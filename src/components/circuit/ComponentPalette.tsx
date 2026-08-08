"use client";

/**
 * 部品パレット（左カラム）。
 *
 * 一覧はレジストリから生成する。Step 7 で MY2N / MY4N-D2 / 端子台 /
 * ダイオードを足しても、このファイルは変更しない。
 */

import type { DragEvent } from "react";

import { componentDefinitions } from "@/circuit/definitions";
import type { ComponentCategory, ComponentDefinition } from "@/circuit/types";
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  hasRealTerminalNumbers,
} from "@/lib/component-display";

import { PALETTE_DND_MIME } from "./palette-dnd";
import styles from "./ComponentPalette.module.css";

/** カテゴリ順に並べ替えたグループ。定義が無いカテゴリは出さない */
const groups: { category: ComponentCategory; items: ComponentDefinition[] }[] =
  CATEGORY_ORDER.map((category) => ({
    category,
    items: componentDefinitions.filter(
      (definition) => definition.category === category,
    ),
  })).filter((group) => group.items.length > 0);

const handleDragStart =
  (definitionId: string) => (event: DragEvent<HTMLElement>) => {
    event.dataTransfer.setData(PALETTE_DND_MIME, definitionId);
    event.dataTransfer.setData("text/plain", definitionId);
    event.dataTransfer.effectAllowed = "copy";
  };

export function ComponentPalette() {
  return (
    <aside className={styles.palette} aria-label="部品パレット">
      <h2 className={styles.title}>部品</h2>
      <p className={styles.hint}>キャンバスへドラッグして配置します。</p>

      {groups.map((group) => (
        <section key={group.category} className={styles.group}>
          <h3 className={styles.groupTitle}>
            {CATEGORY_LABELS[group.category]}
          </h3>
          <ul className={styles.list}>
            {group.items.map((definition) => (
              <li key={definition.id}>
                <div
                  className={styles.item}
                  draggable
                  onDragStart={handleDragStart(definition.id)}
                  title={definition.source}
                >
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
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </aside>
  );
}
