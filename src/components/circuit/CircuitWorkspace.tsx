"use client";

/**
 * 3 カラムレイアウト（design.md §8）。
 *
 * `ReactFlowProvider` をここで張っているのは、Toolbar（`fitView`）と
 * CircuitCanvas（`screenToFlowPosition`）が同じ React Flow インスタンスを
 * 共有する必要があるため。
 */

import { ReactFlowProvider } from "@xyflow/react";

import { CircuitCanvas } from "./CircuitCanvas";
import { ComponentPalette } from "./ComponentPalette";
import { PropertiesPanel } from "./PropertiesPanel";
import { Toolbar } from "./Toolbar";
import { useSimulationSync } from "./useSimulationSync";
import styles from "./CircuitWorkspace.module.css";

export function CircuitWorkspace() {
  // シミュレーションの再計算はここ 1 箇所からだけ駆動する（design.md §8.2）
  useSimulationSync();

  return (
    <ReactFlowProvider>
      <div className={styles.workspace}>
        <Toolbar />
        <div className={styles.columns}>
          <ComponentPalette />
          <CircuitCanvas />
          <PropertiesPanel />
        </div>
      </div>
    </ReactFlowProvider>
  );
}
