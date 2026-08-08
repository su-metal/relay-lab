"use client";

/**
 * シミュレーションの再計算トリガー（design.md §8.2）。
 *
 * `simulate()` は履歴を持たない純粋関数なので、入力が変わったら誰かが呼び直す
 * 必要がある。その「誰か」をこのフック 1 箇所に集約し、`CircuitWorkspace` から
 * 1 回だけ呼ぶ。各コンポーネントが思い思いに `evaluate()` を叩くと、
 * 同じ入力で何度も解いたり逆に解き忘れたりする。
 *
 * 依存に `document` 全体ではなく `components` / `connections` を並べているのは、
 * **パンやズームで `viewport` が変わるたびに回路を解き直さないため。**
 */

import { useEffect } from "react";

import { useCircuitStore } from "@/store/circuitStore";
import { useSimulationStore } from "@/store/simulationStore";

export function useSimulationSync(): void {
  const components = useCircuitStore((state) => state.document.components);
  const connections = useCircuitStore((state) => state.document.connections);
  const running = useSimulationStore((state) => state.running);
  const pressedSwitches = useSimulationStore((state) => state.pressedSwitches);
  const evaluate = useSimulationStore((state) => state.evaluate);

  useEffect(() => {
    // `result` は依存に入れない。入れると評価 → 結果更新 → 再評価の無限ループになる
    evaluate();
  }, [components, connections, running, pressedSwitches, evaluate]);
}
