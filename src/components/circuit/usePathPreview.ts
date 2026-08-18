"use client";

/**
 * 経路確認モードの表示状態（design.md §8.14）。
 *
 * `useWiringCheck` と同じ役割分担で、**エンジンを呼ぶ場所をここ 1 箇所に閉じる。**
 * キャンバス（色）と一覧（止まっている箇所）が同じ 1 回の解を読む。
 *
 * モードに入っていない間は `EMPTY_PATH_PREVIEW` を返すので、呼び出し側に
 * 分岐は要らない。`pathPreview` は `running` と排他（`simulationStore`）。
 *
 * 解き直しの入力は **回路とスイッチの操作の 2 つ。** リレーの励磁は入力に
 * ならない —— このモードでは接点が動かない（§5.15）。
 */

import { useMemo } from "react";

import {
  EMPTY_PATH_PREVIEW,
  buildPathPreview,
  type PathPreviewView,
} from "@/circuit/adapter/path-preview";
import { componentRegistry } from "@/circuit/definitions";
import { useCircuitStore } from "@/store/circuitStore";
import { useSimulationStore } from "@/store/simulationStore";

export function usePathPreview(): PathPreviewView {
  // `document` 全体を購読しない。**パンやズームで解き直さないため**
  // （`useWiringCheck` と同じ理由）。中身は `getState()` でその場で読む
  const components = useCircuitStore((state) => state.document.components);
  const connections = useCircuitStore((state) => state.document.connections);
  const pathPreview = useSimulationStore((state) => state.pathPreview);
  /*
   * 倒しているスイッチ（design.md §8.14）。**これも解き直しの入力。**
   * 購読し忘れると、ボタンを押しても色と一覧が前のままになる。
   */
  const pressedSwitches = useSimulationStore((state) => state.pressedSwitches);

  return useMemo(() => {
    if (!pathPreview) return EMPTY_PATH_PREVIEW;
    return buildPathPreview(
      useCircuitStore.getState().document,
      componentRegistry,
      pressedSwitches,
    );
  }, [components, connections, pathPreview, pressedSwitches]);
}
