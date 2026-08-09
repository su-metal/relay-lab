"use client";

/**
 * 配置を自動整理するショートカット（design.md §8.9）。
 *
 * **L 単独**（Layout / 整列）。削除の D・反転の F と同じく修飾キーを付けない。
 * 整理は「部品を足す → 少しずれる → 整える」を配置の合間に何度も挟む操作で、
 * 操作バーまでポインタを往復させると配線の作業が止まる。
 *
 * Ctrl+L はブラウザのアドレスバーに取られて `preventDefault()` も効かないため、
 * 修飾キー付きの組み合わせは選べない。押し間違えても **Undo 1 回で戻る**
 * （`applyLayout` は履歴を 1 手しか積まない）。
 *
 * **入力欄では発火しない**（`isTextEntry`）。部品名やパレット検索に "l" を
 * 打っても配置は動かない。
 */

import { useEffect } from "react";

import { runAutoArrange } from "./auto-arrange";
import { isTextEntry } from "./keyboard";

export function useArrangeShortcut(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Ctrl+L（アドレスバー）などを奪わない
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      // CapsLock で "L" になる場合も拾う
      if (event.key !== "l" && event.key !== "L") return;
      if (isTextEntry(event.target)) return;

      event.preventDefault();
      runAutoArrange();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
