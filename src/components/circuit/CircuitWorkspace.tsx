"use client";

/**
 * 3 カラムレイアウト（design.md §8）。
 *
 * `ReactFlowProvider` をここで張っているのは、Toolbar（`fitView`）と
 * CircuitCanvas（`screenToFlowPosition`）、保存の復元（`setViewport`）が
 * 同じ React Flow インスタンスを共有する必要があるため。
 *
 * **中身を `Workspace` に分けているのはそのため。** プロバイダーを張った
 * コンポーネント自身は `useReactFlow()` を呼べないので、フックを使う層を
 * 1 段内側へ落としている。
 */

import { ReactFlowProvider } from "@xyflow/react";

import { CircuitCanvas } from "./CircuitCanvas";
import { ComponentPalette } from "./ComponentPalette";
import { PropertiesPanel } from "./PropertiesPanel";
import { Toolbar } from "./Toolbar";
import { WarningList } from "./WarningList";
import { useDocumentPersistence } from "./useDocumentPersistence";
import { useFlipShortcut } from "./useFlipShortcut";
import { useHistoryShortcuts } from "./useHistoryShortcuts";
import { useSimulationSync } from "./useSimulationSync";
import styles from "./CircuitWorkspace.module.css";

export function CircuitWorkspace() {
  return (
    <ReactFlowProvider>
      <Workspace />
    </ReactFlowProvider>
  );
}

function Workspace() {
  // シミュレーションの再計算はここ 1 箇所からだけ駆動する（design.md §8.2）
  useSimulationSync();
  // 保存・復元も同じく 1 箇所（design.md §8.4）
  const persistence = useDocumentPersistence();
  useHistoryShortcuts();
  useFlipShortcut();

  return (
    <div className={styles.workspace}>
      <Toolbar saveStatus={persistence.status} />

      {persistence.notices.length > 0 && (
        <LoadNotices
          notices={persistence.notices}
          onDismiss={persistence.dismissNotices}
        />
      )}

      <div className={styles.columns}>
        <ComponentPalette />
        <CircuitCanvas />
        <div className={styles.inspector}>
          <PropertiesPanel />
          <WarningList />
        </div>
      </div>
    </div>
  );
}

/**
 * 読み込み時に捨てた要素の通知。
 *
 * **黙って捨てない。** 未知の型番の部品を落とせば回路は静かに欠けるので、
 * 何が読めなかったのかを一度だけ知らせる（要件 US-E）。
 */
function LoadNotices({
  notices,
  onDismiss,
}: {
  notices: readonly string[];
  onDismiss: () => void;
}) {
  const shown = notices.slice(0, 3);
  const hidden = notices.length - shown.length;

  return (
    <div className={styles.notices} role="status">
      <ul className={styles.noticeList}>
        {shown.map((notice, index) => (
          <li key={index}>{notice}</li>
        ))}
        {hidden > 0 && <li>他 {hidden} 件</li>}
      </ul>
      <button
        type="button"
        className={styles.noticeClose}
        onClick={onDismiss}
        aria-label="通知を閉じる"
      >
        ×
      </button>
    </div>
  );
}
