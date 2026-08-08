"use client";

/**
 * 診断（右カラム下段・design.md §8.4）。
 *
 * `SimulationResult.warnings` をそのまま出す表示専用のコンポーネント。
 * **判定も文面の組み立てもここには書かない** — 本文はエンジン（`validation.ts`）が
 * 日本語で持っており、並べ替えと束ねだけを `lib/warning-display.ts` が受け持つ。
 *
 * 停止中（`result === null`）は「問題なし」ではなく「未実行」と出す。
 * 診断していないことと、診断して何も出なかったことは別物。
 */

import { useState } from "react";

import type { Warning } from "@/circuit/types";
import {
  SEVERITY_LABELS,
  VISIBLE_PER_GROUP,
  groupWarnings,
} from "@/lib/warning-display";
import { useCircuitStore } from "@/store/circuitStore";
import { useSimulationStore } from "@/store/simulationStore";

import styles from "./WarningList.module.css";

export function WarningList() {
  const result = useSimulationStore((state) => state.result);
  const selectOnlyComponent = useCircuitStore(
    (state) => state.selectOnlyComponent,
  );

  /** 「他 N 件」を開いたグループ。未接続端子は既定で畳む */
  const [expanded, setExpanded] = useState<readonly string[]>([]);

  const groups = groupWarnings(result?.warnings ?? []);
  const total = result?.warnings.length ?? 0;

  return (
    <section className={styles.panel} aria-label="診断">
      <h2 className={styles.title}>
        診断
        {total > 0 && <span className={styles.total}>{total}</span>}
      </h2>

      {!result ? (
        <p className={styles.empty}>▶ 実行すると診断結果を表示します。</p>
      ) : groups.length === 0 ? (
        <p className={styles.empty}>指摘はありません。</p>
      ) : (
        <ul className={styles.groups}>
          {groups.map((group) => {
            const open = expanded.includes(group.key);
            const shown = open
              ? group.warnings
              : group.warnings.slice(0, VISIBLE_PER_GROUP);
            const hidden = group.warnings.length - shown.length;

            return (
              <li key={group.key} className={styles.group}>
                <h3 className={styles.groupHead} data-severity={group.severity}>
                  <span className={styles.severity}>
                    {SEVERITY_LABELS[group.severity]}
                  </span>
                  <span className={styles.groupLabel}>{group.label}</span>
                  <span className={styles.count}>{group.warnings.length}</span>
                </h3>

                <ul className={styles.items}>
                  {shown.map((warning, index) => (
                    <WarningItem
                      key={`${group.key}-${index}`}
                      warning={warning}
                      onSelect={selectOnlyComponent}
                    />
                  ))}
                </ul>

                {(hidden > 0 || open) && (
                  <button
                    type="button"
                    className={styles.more}
                    onClick={() =>
                      setExpanded((current) =>
                        open
                          ? current.filter((key) => key !== group.key)
                          : [...current, group.key],
                      )
                    }
                  >
                    {open ? "折りたたむ" : `他 ${hidden} 件を表示`}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * 警告 1 件。該当部品があればクリックで選択し、プロパティパネルへ送る。
 * 部品を特定できない警告（発振・収束せず）は押せない `<p>` のまま出す。
 */
function WarningItem({
  warning,
  onSelect,
}: {
  warning: Warning;
  onSelect: (componentId: string) => void;
}) {
  if (!warning.componentId) {
    return <li className={styles.itemStatic}>{warning.message}</li>;
  }

  const componentId = warning.componentId;
  return (
    <li>
      <button
        type="button"
        className={styles.item}
        onClick={() => onSelect(componentId)}
        title="該当する部品を選択します"
      >
        {warning.message}
      </button>
    </li>
  );
}
