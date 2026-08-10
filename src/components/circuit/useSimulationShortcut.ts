"use client";

/**
 * シミュレーションの開始・停止を切り替えるショートカット（design.md §8.2）。
 *
 * **S 単独**（Start / Stop）。削除の D・反転の F・整列の L と同じく修飾キーを
 * 付けない（§8.1）。開始と停止は 1 キーのトグルで、いまの `running` で行き先が
 * 決まる。Ctrl+S（ブラウザの保存）は修飾キーで弾くので奪わない。
 *
 * **Space は採らない。** スイッチの押しボタンは Space / Enter で押下・復帰を
 * 表現しており（`SwitchBody`）、シミュレーション中はそのボタンにフォーカスが
 * 残る。Space を停止に割り当てると「スイッチを押す」のか「停止する」のかが
 * 押した瞬間のフォーカス位置で変わってしまう。開始・停止ボタン自身にも
 * フォーカスが残るため、ネイティブの click と二重に発火する。
 * React Flow の Space パン（`panActivationKeyCode` 既定）は Shift へ
 * 移してあるが（§8.6）、この 2 つは残る。
 *
 * **入力欄では発火しない**（`isTextEntry`）。部品名やパレット検索に "s" を
 * 打ってもシミュレーションは始まらない。
 *
 * **押しっぱなしでは連打しない**（`event.repeat`）。キーリピートでトグルが
 * 走ると、開始のたびに `pressedSwitches` と前回の励磁状態が捨てられる（§7）。
 */

import { useEffect } from "react";

import { useSimulationStore } from "@/store/simulationStore";

import { isTextEntry } from "./keyboard";

export function useSimulationShortcut(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Ctrl+S（ブラウザの保存）などを奪わない
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      // CapsLock で "S" になる場合も拾う
      if (event.key !== "s" && event.key !== "S") return;
      if (event.repeat) return;
      if (isTextEntry(event.target)) return;

      event.preventDefault();
      // ストアは購読せずその場で読む。running が変わるたびに
      // リスナーを張り直さないため（`useFlipShortcut` と同じ）
      const { running, start, stop } = useSimulationStore.getState();
      if (running) {
        stop();
      } else {
        start();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
