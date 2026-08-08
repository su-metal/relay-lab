"use client";

/**
 * 操作バー（上部）。
 *
 * ▶ / ■ でシミュレーションを開始・停止する。実行中の状態表示は
 * 収束の結果（`SimulationStatus`）までに留め、警告の一覧表示は Step 6。
 */

import { useReactFlow } from "@xyflow/react";
import { useCallback } from "react";

import type { SimulationStatus } from "@/circuit/types";
import { APP_NAME } from "@/lib/app-info";
import { useCircuitStore } from "@/store/circuitStore";
import { useSimulationStore } from "@/store/simulationStore";

import styles from "./Toolbar.module.css";

/**
 * 収束結果の表示文言（design.md §5.5）。
 *
 * **発振はエラーではない。** B 接点による自励発振（ブザー回路）は
 * 配線として正しくても必ず起きるので、挙動として提示する。
 */
const STATUS_LABEL: Record<SimulationStatus, string> = {
  stable: "実行中",
  oscillating: "発振中（ブザー動作）",
  "not-converged": "収束しません",
};

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

  const running = useSimulationStore((state) => state.running);
  const status = useSimulationStore((state) => state.result?.status);
  const start = useSimulationStore((state) => state.start);
  const stop = useSimulationStore((state) => state.stop);

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
          onClick={start}
          disabled={running}
          title="回路を解いて通電状態を表示します"
        >
          ▶ シミュレーション開始
        </button>
        <button
          type="button"
          className={styles.button}
          onClick={stop}
          disabled={!running}
          title="シミュレーションを停止し、押下状態と励磁状態を捨てます"
        >
          ■ 停止
        </button>
        {running && (
          <span className={styles.status} data-status={status ?? "stable"}>
            {STATUS_LABEL[status ?? "stable"]}
          </span>
        )}
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
