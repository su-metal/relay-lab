"use client";

/**
 * 診断（右カラム下段・design.md §8.4）。
 *
 * `SimulationResult.warnings` をそのまま出す表示専用のコンポーネント。
 * **判定も文面の組み立てもここには書かない** — 本文はエンジン（`validation.ts`）が
 * 日本語で持っており、並べ替えと束ねだけを `lib/warning-display.ts` が受け持つ。
 *
 * **停止中は「配線チェック」に切り替わる**（design.md §5.7・§8.4）。電源を入れる
 * 前から分かる指摘（未接続の端子・静止状態の短絡・ダイオードの向き）はここで出し、
 * ボタンを押して初めて起きることは ▶ の診断に任せる。停止中に何も出ないことを
 * 「問題なし」と読ませないよう、見出しと注記でどちらを見ているかを必ず示す。
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

import { useWiringCheck } from "./useWiringCheck";
import styles from "./WarningList.module.css";

export function WarningList() {
  const result = useSimulationStore((state) => state.result);
  const wiringCheck = useWiringCheck();
  const selectOnlyComponent = useCircuitStore(
    (state) => state.selectOnlyComponent,
  );

  /** 「他 N 件」を開いたグループ。未接続端子は既定で畳む */
  const [expanded, setExpanded] = useState<readonly string[]>([]);

  const empty = useCircuitStore(
    (state) => state.document.components.length === 0,
  );

  const running = result !== null;
  const warnings = running ? result.warnings : wiringCheck;
  const groups = groupWarnings(warnings);
  const total = warnings.length;

  return (
    <section className={styles.panel} aria-label="診断">
      <h2 className={styles.title}>
        {running ? "診断" : "配線チェック"}
        {total > 0 && <span className={styles.total}>{total}</span>}
      </h2>

      {/*
        いま何を見ているのかを常に添える。停止中の「指摘はありません」を
        「この回路は正しい」と読まれるのが、この画面でいちばん困る誤解
      */}
      {!running && !empty && (
        <p className={styles.scope}>
          電源を入れずに分かる範囲を見ています。押しボタンを押して初めて起きることは
          ▶ で確認してください。
        </p>
      )}

      {groups.length === 0 ? (
        <p className={styles.empty}>
          {empty
            ? "部品を置くと配線チェックを表示します。"
            : running
              ? "指摘はありません。"
              : "配線そのものへの指摘はありません。"}
        </p>
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
