"use client";

/**
 * プロパティパネル（右カラム）。
 *
 * Step 3 では選択部品の素性（メーカー・型番・端子数・出典・検証状態）までを出す。
 * 端子ごとの導通状態やコイルの励磁状態のリアルタイム表示は Step 5。
 */

import { componentRegistry } from "@/circuit/definitions";
import { CATEGORY_LABELS, hasRealTerminalNumbers } from "@/lib/component-display";
import { useCircuitStore } from "@/store/circuitStore";

import styles from "./PropertiesPanel.module.css";

export function PropertiesPanel() {
  const components = useCircuitStore((state) => state.document.components);
  const selectedComponentIds = useCircuitStore(
    (state) => state.selectedComponentIds,
  );

  const selectedId = selectedComponentIds[0];
  const instance = components.find((component) => component.id === selectedId);
  const definition = instance
    ? componentRegistry.get(instance.definitionId)
    : undefined;

  return (
    <aside className={styles.panel} aria-label="プロパティ">
      <h2 className={styles.title}>プロパティ</h2>

      {selectedComponentIds.length > 1 && (
        <p className={styles.empty}>
          {selectedComponentIds.length} 個の部品を選択中です。
        </p>
      )}

      {!instance || !definition ? (
        <p className={styles.empty}>部品を選択すると詳細を表示します。</p>
      ) : (
        <dl className={styles.rows}>
          <div className={styles.row}>
            <dt>名前</dt>
            <dd>{instance.label ?? "—"}</dd>
          </div>
          <div className={styles.row}>
            <dt>メーカー</dt>
            <dd>{definition.manufacturer ?? "—"}</dd>
          </div>
          <div className={styles.row}>
            <dt>型番</dt>
            <dd>{definition.model}</dd>
          </div>
          <div className={styles.row}>
            <dt>種別</dt>
            <dd>{CATEGORY_LABELS[definition.category]}</dd>
          </div>
          <div className={styles.row}>
            <dt>端子数</dt>
            <dd>{definition.terminals.length}</dd>
          </div>
          <div className={styles.row}>
            <dt>端子データ</dt>
            <dd>
              {!hasRealTerminalNumbers(definition) ? (
                // 実端子番号が存在しない汎用部品。検証の対象そのものが無い
                "実端子番号なし"
              ) : definition.verified ? (
                "検証済み"
              ) : (
                <span className={styles.unverified}>未検証</span>
              )}
            </dd>
          </div>
          {definition.source && (
            <div className={styles.row}>
              <dt>出典</dt>
              <dd className={styles.source}>{definition.source}</dd>
            </div>
          )}
        </dl>
      )}

      <p className={styles.note}>
        端子ごとの状態表示は Step 5、シミュレーションは Step 4 で有効になります。
      </p>
    </aside>
  );
}
