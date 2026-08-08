"use client";

/**
 * 操作バー（上部）。
 *
 * ▶ / ■ でシミュレーションを開始・停止し、↶ / ↷ で操作を戻す・やり直す。
 * 収束の結果（`SimulationStatus`）と保存状態をここに出し、
 * 警告の一覧は右カラム下段の `WarningList` が受け持つ（design.md §8.4）。
 */

import { useReactFlow } from "@xyflow/react";
import { useCallback } from "react";

import type { SimulationStatus } from "@/circuit/types";
import { APP_NAME } from "@/lib/app-info";
import { useCircuitStore } from "@/store/circuitStore";
import { useSimulationStore } from "@/store/simulationStore";

import type { PersistenceStatus } from "./useDocumentPersistence";
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

/**
 * 保存状態の表示（design.md §8.4）。
 *
 * 自動保存は目に見えないので、**保存できていない環境をここで必ず知らせる。**
 * 「保存済み」と出せない状況を黙っていると、リロードで回路が消えて初めて気付く。
 */
const SAVE_LABEL: Record<PersistenceStatus, string> = {
  loading: "読み込み中…",
  saved: "保存済み",
  pending: "保存中…",
  unavailable: "保存できません",
  error: "保存に失敗しました",
};

export function Toolbar({ saveStatus }: { saveStatus: PersistenceStatus }) {
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

  const undo = useCircuitStore((state) => state.undo);
  const redo = useCircuitStore((state) => state.redo);
  const canUndo = useCircuitStore((state) => state.past.length > 0);
  const canRedo = useCircuitStore((state) => state.future.length > 0);

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
          onClick={undo}
          disabled={!canUndo}
          title="直前の操作を取り消します（Ctrl/⌘ + Z）"
        >
          ↶ 元に戻す
        </button>
        <button
          type="button"
          className={styles.button}
          onClick={redo}
          disabled={!canRedo}
          title="取り消した操作をやり直します（Ctrl/⌘ + Shift + Z）"
        >
          ↷ やり直す
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
      <span className={styles.save} data-status={saveStatus}>
        {SAVE_LABEL[saveStatus]}
      </span>
    </header>
  );
}
