"use client";

/**
 * 選択中の部品を左右反転するショートカット（design.md §8.1）。
 *
 * **F 単独。** 反転は配置しながら何度も試す操作で、右パネルのボタンまで
 * ポインタを往復させると配線の作業が止まる。削除の D 単独と同じ理由で
 * 修飾キーを付けない。
 *
 * 複数選択していれば **それぞれを個別に**反転する。並んだ部品の向きを
 * まとめて揃えるより、選んだものを一斉に裏返すほうが図面の直しに合う。
 *
 * **入力欄では発火しない**（`isTextEntry`）。部品名やパレット検索に "f" を
 * 打っても回路は変わらない。React Flow の `deleteKeyCode` が内部で行っている
 * 除外を、自前のハンドラーでは自分で書く必要がある。
 */

import { useEffect } from "react";

import { useCircuitStore } from "@/store/circuitStore";

import { isTextEntry } from "./keyboard";

export function useFlipShortcut(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Ctrl+F（ブラウザの検索）などを奪わない
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      // CapsLock で "F" になる場合も拾う
      if (event.key !== "f" && event.key !== "F") return;
      if (isTextEntry(event.target)) return;

      // ストアは購読せずその場で読む。選択が変わるたびに
      // リスナーを張り直さないため（MY4N 1 個で端子 14 個ぶんの再描画が走る）
      const { selectedComponentIds, flipComponents } =
        useCircuitStore.getState();
      if (selectedComponentIds.length === 0) return;

      event.preventDefault();
      flipComponents(selectedComponentIds);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
