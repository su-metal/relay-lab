"use client";

/**
 * シミュレーションの実行時状態（design.md §7）。
 *
 * 保持するのは `running` / `pressedSwitches` / 最新の `SimulationResult` だけで、
 * **保存対象には一切含めない。** `circuitStore` と混ぜると保存 JSON に実行時状態が
 * 混入し、Undo 履歴もシミュレーション中の変化で汚れる。
 *
 * このストアは `circuitStore` を **読むだけ**（`evaluate()` の中の `getState()`）。
 * 逆向きの依存は作らない。回路が変わればシミュレーションは解き直すべきだが、
 * シミュレーション結果が回路を書き換えることは無い、という一方向を保つ。
 */

import { create } from "zustand";

import { componentRegistry } from "@/circuit/definitions";
import { simulate } from "@/circuit/engine";
import type { SimulationResult } from "@/circuit/types";

import { useCircuitStore } from "./circuitStore";

const EMPTY_PRESSED: ReadonlySet<string> = new Set();

export type SimulationStore = {
  running: boolean;
  /** 押下中の押しボタンの componentId */
  pressedSwitches: ReadonlySet<string>;
  /** 最新の結果。停止中は null */
  result: SimulationResult | null;

  start: () => void;
  stop: () => void;

  /**
   * モーメンタリ操作。マウスダウンで押下、マウスアップで復帰する。
   * 停止中の操作は無視する（結果が無いのに入力だけ溜まるのを防ぐ）。
   */
  pressSwitch: (componentId: string) => void;
  releaseSwitch: (componentId: string) => void;

  /**
   * 現在の回路と入力で解き直す。
   * 入力（回路 / 押下状態 / 実行状態）が変わるたびに `useSimulationSync` が呼ぶ。
   */
  evaluate: () => void;
};

export const useSimulationStore = create<SimulationStore>()((set, get) => ({
  running: false,
  pressedSwitches: EMPTY_PRESSED,
  result: null,

  // 開始時は前回の結果を捨てる。残すと前回の励磁状態が
  // `previousEnergizedRelays` として引き継がれ、押していない自己保持回路が
  // 最初から励磁した状態で立ち上がってしまう
  start: () =>
    set({ running: true, pressedSwitches: EMPTY_PRESSED, result: null }),

  stop: () =>
    set({ running: false, pressedSwitches: EMPTY_PRESSED, result: null }),

  pressSwitch: (componentId) =>
    set((state) => {
      if (!state.running || state.pressedSwitches.has(componentId)) return {};
      const next = new Set(state.pressedSwitches);
      next.add(componentId);
      return { pressedSwitches: next };
    }),

  releaseSwitch: (componentId) =>
    set((state) => {
      if (!state.pressedSwitches.has(componentId)) return {};
      const next = new Set(state.pressedSwitches);
      next.delete(componentId);
      return { pressedSwitches: next };
    }),

  evaluate: () => {
    const { running, pressedSwitches, result } = get();

    if (!running) {
      if (result !== null) set({ result: null });
      return;
    }

    // 前回の励磁状態を必ず渡す。渡し忘れると自己保持回路が毎回解け、
    // ボタンを離した瞬間に落ちる（design.md §3.4 / §6-6）
    set({
      result: simulate(useCircuitStore.getState().document, componentRegistry, {
        pressedSwitches,
        previousEnergizedRelays: result?.energizedRelays,
      }),
    });
  },
}));
