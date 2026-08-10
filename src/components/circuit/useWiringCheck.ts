"use client";

/**
 * 停止中の配線チェック（design.md §8.4）。
 *
 * `useSimulationSync` と同じ役割分担で、**エンジンを呼ぶ場所をここ 1 箇所に
 * 閉じる。** `WarningList` は表示だけを受け持つ（判定も文面も持たない）。
 *
 * 実行中は何も返さない。▶ の診断（`SimulationResult.warnings`）のほうが
 * 静止状態の 1 パスより厳密に多くを見ており、**両方並べると同じ未接続端子が
 * 二重に出る。**
 */

import { useMemo } from "react";

import { componentRegistry } from "@/circuit/definitions";
import { inspectWiring } from "@/circuit/engine";
import type { Warning } from "@/circuit/types";
import { useCircuitStore } from "@/store/circuitStore";
import { useSimulationStore } from "@/store/simulationStore";

const NONE: readonly Warning[] = [];

export function useWiringCheck(): readonly Warning[] {
  // `document` 全体を購読しない。**パンやズームで解き直さないため**
  // （`useSimulationSync` と同じ理由）。中身は `getState()` でその場で読む
  const components = useCircuitStore((state) => state.document.components);
  const connections = useCircuitStore((state) => state.document.connections);
  const running = useSimulationStore((state) => state.running);

  return useMemo(() => {
    if (running) return NONE;
    if (components.length === 0) return NONE;
    return inspectWiring(useCircuitStore.getState().document, componentRegistry);
  }, [components, connections, running]);
}
