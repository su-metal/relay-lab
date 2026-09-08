"use client";

/**
 * デスクトップの左右パネルを開閉するショートカット。
 *
 * C = 部品パネル、P = プロパティパネル、M = 左右まとめて開閉。
 * 文字入力中は発火させず、Ctrl/⌘/Alt 付きのブラウザ操作も奪わない。
 * 狭い画面では左右カラム自体が無くシート UI に切り替わるため無効にする。
 */

import { useEffect } from "react";

import {
  COMPONENT_PANEL_KEYS,
  MAIN_VIEW_KEYS,
  PROPERTIES_PANEL_KEYS,
} from "@/lib/shortcuts";

import { isTextEntry } from "./keyboard";

export type PanelShortcutOptions = {
  compact: boolean;
  onToggleComponentPanel: () => void;
  onTogglePropertiesPanel: () => void;
  onToggleAllPanels: () => void;
};

export function usePanelShortcuts({
  compact,
  onToggleComponentPanel,
  onTogglePropertiesPanel,
  onToggleAllPanels,
}: PanelShortcutOptions): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (compact) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTextEntry(event.target)) return;

      if (COMPONENT_PANEL_KEYS.includes(event.key)) {
        event.preventDefault();
        onToggleComponentPanel();
        return;
      }
      if (PROPERTIES_PANEL_KEYS.includes(event.key)) {
        event.preventDefault();
        onTogglePropertiesPanel();
        return;
      }
      if (MAIN_VIEW_KEYS.includes(event.key)) {
        event.preventDefault();
        onToggleAllPanels();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    compact,
    onToggleAllPanels,
    onToggleComponentPanel,
    onTogglePropertiesPanel,
  ]);
}
