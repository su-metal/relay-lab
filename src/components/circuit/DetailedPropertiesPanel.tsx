"use client";

import { useMemo } from "react";

import { buildTerminalConnections } from "@/circuit/adapter/terminal-connections";
import { componentRegistry } from "@/circuit/definitions";
import type { TerminalDefinition } from "@/circuit/types";
import { terminalRefKey } from "@/circuit/types";
import { TERMINAL_ROLE_LABELS } from "@/lib/component-display";
import { useCircuitStore } from "@/store/circuitStore";

import { PropertiesPanel } from "./PropertiesPanel";
import styles from "./DetailedPropertiesPanel.module.css";

/**
 * 端子のツールチップと同じ `TerminalDefinition.description` を、
 * プロパティ欄では端子番号の重複を省いて読みやすくする。
 *
 * 定義側は「端子 22 / 通信線 ＋」のような形を基本にしているが、
 * 説明を持たない汎用端子もあるので、その場合だけ role の表示名へ戻す。
 */
export const terminalDetailText = (terminal: TerminalDefinition): string => {
  const description = terminal.description?.trim();
  if (!description) return TERMINAL_ROLE_LABELS[terminal.role];

  const prefixes = [
    `端子 ${terminal.label} / `,
    `端子 ${terminal.id} / `,
    `端子${terminal.label} / `,
    `端子${terminal.id} / `,
  ];
  const prefix = prefixes.find((candidate) => description.startsWith(candidate));
  return prefix ? description.slice(prefix.length) : description;
};

/**
 * 既存のプロパティパネルに「端子詳細」を足すラッパー。
 *
 * 元の端子一覧は電位状態（非通電 / + / 0V など）を読む場所として残し、
 * ここでは定義側が持つ用途説明と、実際にどこへ配線されているかを表示する。
 * 役割を分けることで、通信端子のように `role: generic` でも情報を落とさない。
 */
export function DetailedPropertiesPanel() {
  const document = useCircuitStore((state) => state.document);
  const selectedComponentIds = useCircuitStore(
    (state) => state.selectedComponentIds,
  );

  const selected =
    selectedComponentIds.length === 1
      ? document.components.find(
          (component) => component.id === selectedComponentIds[0],
        )
      : undefined;
  const definition = selected
    ? componentRegistry.get(selected.definitionId)
    : undefined;

  const connections = useMemo(
    () => buildTerminalConnections(document, componentRegistry),
    [document],
  );

  return (
    <div className={styles.wrapper}>
      <PropertiesPanel />

      {selected && definition && (
        <section className={styles.details} aria-label="端子詳細">
          <h3 className={styles.heading}>端子詳細</h3>
          <p className={styles.intro}>
            端子の用途と、直接つながっている相手を表示します。
          </p>
          <ul className={styles.list}>
            {definition.terminals.map((terminal) => {
              const connected = connections.get(
                terminalRefKey({
                  componentId: selected.id,
                  terminalId: terminal.id,
                }),
              );

              return (
                <li key={terminal.id} className={styles.row}>
                  <span className={styles.number}>{terminal.label}</span>
                  <span className={styles.info}>
                    <span className={styles.purpose}>
                      {terminalDetailText(terminal)}
                    </span>
                    <span className={styles.connection}>
                      {connected && connected.length > 0
                        ? `接続: ${connected
                            .map(
                              (entry) =>
                                `${entry.componentName} の端子 ${entry.terminalLabel}`,
                            )
                            .join("、")}`
                        : "未接続"}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
