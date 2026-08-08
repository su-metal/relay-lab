"use client";

/**
 * Undo / Redo のキーボードショートカット（design.md §8.4）。
 *
 * `Ctrl/⌘ + Z` で元に戻す、`Ctrl/⌘ + Shift + Z` または `Ctrl + Y` でやり直す。
 *
 * **入力欄にフォーカスがあるときは何もしない。** プロパティパネルの名前欄で
 * 打ち間違えて Ctrl+Z を押したときに、文字ではなく回路が巻き戻ると
 * 何が起きたのか分からなくなる。ラベル編集はそもそも履歴に積んでいない（§7）。
 */

import { useEffect } from "react";

import { useCircuitStore } from "@/store/circuitStore";

import { isTextEntry } from "./keyboard";

export function useHistoryShortcuts(): void {
  const undo = useCircuitStore((state) => state.undo);
  const redo = useCircuitStore((state) => state.redo);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      const key = event.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      if (isTextEntry(event.target)) return;

      event.preventDefault();
      if (key === "y" || event.shiftKey) {
        redo();
      } else {
        undo();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);
}
