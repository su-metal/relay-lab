"use client";

/**
 * 操作バー（上部）。
 *
 * ▶ / ■ はシミュレーション用で、実際に動くのは Step 4（エンジン接続）。
 * Step 3 では配置と配線に必要な操作だけを有効にしてある。
 */

import { useReactFlow } from "@xyflow/react";
import { useCallback } from "react";

import { APP_NAME } from "@/lib/app-info";
import { useCircuitStore } from "@/store/circuitStore";

import styles from "./Toolbar.module.css";

export function Toolbar() {
  const { fitView } = useReactFlow();

  const componentCount = useCircuitStore(
    (state) => state.document.components.length,
  );
  const connectionCount = useCircuitStore(
    (state) => state.document.connections.length,
  );
  const selectedComponentIds = useCircuitStore(
    (state) => state.selectedComponentIds,
  );
  const selectedConnectionIds = useCircuitStore(
    (state) => state.selectedConnectionIds,
  );
  const removeSelected = useCircuitStore((state) => state.removeSelected);

  const selectedCount =
    selectedComponentIds.length + selectedConnectionIds.length;

  const handleFitView = useCallback(() => {
    void fitView({ padding: 0.2, duration: 200 });
  }, [fitView]);

  return (
    <header className={styles.toolbar}>
      <span className={styles.brand}>{APP_NAME}</span>

      <div className={styles.group}>
        <button
          type="button"
          className={styles.run}
          disabled
          title="Step 4（エンジン接続）で有効になります"
        >
          ▶ シミュレーション開始
        </button>
        <button
          type="button"
          className={styles.button}
          disabled
          title="Step 4（エンジン接続）で有効になります"
        >
          ■ 停止
        </button>
      </div>

      <div className={styles.group}>
        <button
          type="button"
          className={styles.button}
          onClick={removeSelected}
          disabled={selectedCount === 0}
          title="選択中の部品と配線を削除します（Delete キーでも可）"
        >
          選択を削除
          {selectedCount > 0 && ` (${selectedCount})`}
        </button>
        <button type="button" className={styles.button} onClick={handleFitView}>
          全体表示
        </button>
      </div>

      <span className={styles.counts}>
        部品 {componentCount} ／ 配線 {connectionCount}
      </span>
    </header>
  );
}
