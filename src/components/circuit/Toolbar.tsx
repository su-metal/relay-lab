"use client";

/**
 * 操作バー（上部）。
 *
 * キャンバスの縦幅を削らないため、広い画面でも狭い画面でも **1 段を維持する**。
 * 常用操作だけを直接置き、選択対象・整列・表示・ファイル操作はメニューへ畳む。
 * ブラウザの表示倍率を上げても文字がボタンからはみ出さないよう、ボタンは内容幅を
 * 下限にして折り返さない。さらに幅が足りないときだけ補助情報やラベルを段階的に畳む。
 */

import { useReactFlow } from "@xyflow/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";

import { CIRCUIT_FILE_ACCEPT } from "@/circuit/persistence/document-file";
import type { SimulationStatus } from "@/circuit/types";
import { APP_NAME } from "@/lib/app-info";
import { useCircuitStore } from "@/store/circuitStore";
import { useSimulationStore } from "@/store/simulationStore";

import { ALIGN_MENU_ITEMS, canRunAlign, runAlign } from "./align-components";
import { runAutoArrange } from "./auto-arrange";
import { RANGE_SELECTION_TARGETS } from "./range-selection";
import type { RangeSelectionTarget } from "./range-selection";
import type { PersistenceStatus } from "./useDocumentPersistence";
import styles from "./Toolbar.module.css";

const STATUS_LABEL: Record<SimulationStatus, string> = {
  stable: "実行中",
  oscillating: "発振中",
  "not-converged": "収束せず",
};

const STATUS_TITLE: Record<SimulationStatus, string> = {
  stable: "シミュレーション実行中",
  oscillating: "発振中（ブザー動作など、回路が安定状態に収束していません）",
  "not-converged": "収束しません。回路または設定を確認してください",
};

const SAVE_LABEL: Record<PersistenceStatus, string> = {
  loading: "読み込み中…",
  saved: "保存済み",
  pending: "保存中…",
  unavailable: "保存できません",
  error: "保存に失敗しました",
};

const RANGE_SELECTION_SHORT_LABEL: Record<RangeSelectionTarget, string> = {
  both: "両方",
  components: "部品",
  connections: "配線",
};

type ToolbarMenu = "selection" | "arrange" | "view" | "file" | "more";

export type ToolbarProps = {
  /**
   * 3 カラムを畳む狭い画面か（design.md §8.12）。
   * 狭い画面では頻度の低い操作を「その他」へさらにまとめ、1 段を守る。
   */
  compact: boolean;
  saveStatus: PersistenceStatus;
  rangeSelectionTarget: RangeSelectionTarget;
  onRangeSelectionTargetChange: (value: RangeSelectionTarget) => void;
  onExportFile: () => void;
  onImportFile: (file: File) => Promise<void>;
  onOpenHelp: () => void;
  onOpenLadder: () => void;
};

export function Toolbar({
  compact,
  saveStatus,
  rangeSelectionTarget,
  onRangeSelectionTargetChange,
  onExportFile,
  onImportFile,
  onOpenHelp,
  onOpenLadder,
}: ToolbarProps) {
  const { fitView } = useReactFlow();
  const toolbarRef = useRef<HTMLElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectionTriggerRef = useRef<HTMLButtonElement>(null);
  const arrangeTriggerRef = useRef<HTMLButtonElement>(null);
  const viewTriggerRef = useRef<HTMLButtonElement>(null);
  const fileTriggerRef = useRef<HTMLButtonElement>(null);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  const [openMenu, setOpenMenu] = useState<ToolbarMenu | null>(null);

  const componentCount = useCircuitStore(
    (state) => state.document.components.length,
  );
  const connectionCount = useCircuitStore(
    (state) => state.document.connections.length,
  );
  const selectedComponentIds = useCircuitStore(
    (state) => state.selectedComponentIds,
  );
  const selectedConnectionIds = useCircuitStore(
    (state) => state.selectedConnectionIds,
  );
  const removeSelected = useCircuitStore((state) => state.removeSelected);

  const undo = useCircuitStore((state) => state.undo);
  const redo = useCircuitStore((state) => state.redo);
  const canUndo = useCircuitStore((state) => state.past.length > 0);
  const canRedo = useCircuitStore((state) => state.future.length > 0);

  const running = useSimulationStore((state) => state.running);
  const status = useSimulationStore((state) => state.result?.status);
  const nowMs = useSimulationStore((state) => state.nowMs);
  const hasTimers = useSimulationStore(
    (state) => (state.result?.timers.size ?? 0) > 0,
  );
  const start = useSimulationStore((state) => state.start);
  const stop = useSimulationStore((state) => state.stop);
  const pathPreview = useSimulationStore((state) => state.pathPreview);
  const togglePathPreview = useSimulationStore(
    (state) => state.togglePathPreview,
  );

  const selectedCount =
    selectedComponentIds.length + selectedConnectionIds.length;
  const canAlign = selectedComponentIds.length >= 2;
  const currentStatus = status ?? "stable";

  const focusMenuTrigger = useCallback((menu: ToolbarMenu) => {
    const target =
      menu === "selection"
        ? selectionTriggerRef.current
        : menu === "arrange"
          ? arrangeTriggerRef.current
          : menu === "view"
            ? viewTriggerRef.current
            : menu === "file"
              ? fileTriggerRef.current
              : moreTriggerRef.current;
    target?.focus();
  }, []);

  /**
   * 開いているメニューは、外側クリックと Esc で閉じる。
   * メニュー内のキー入力はキャンバスの Delete / D などへ流さない。
   */
  useEffect(() => {
    if (!openMenu) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest("[data-toolbar-menu-root]")
      ) {
        return;
      }
      setOpenMenu(null);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        const closing = openMenu;
        setOpenMenu(null);
        requestAnimationFrame(() => focusMenuTrigger(closing));
        return;
      }
      const target = event.target;
      if (target instanceof Element && target.closest('[role="menu"]')) {
        event.stopPropagation();
      }
    };

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [focusMenuTrigger, openMenu]);

  const toggleMenu = useCallback((menu: ToolbarMenu) => {
    setOpenMenu((current) => (current === menu ? null : menu));
  }, []);

  const handleAlign = useCallback((mode: Parameters<typeof runAlign>[0]) => {
    runAlign(mode);
    setOpenMenu(null);
  }, []);

  const handleAutoArrange = useCallback(() => {
    runAutoArrange();
    setOpenMenu(null);
  }, []);

  const handleFitView = useCallback(() => {
    setOpenMenu(null);
    void fitView({ padding: 0.2, duration: 200 });
  }, [fitView]);

  const handleExport = useCallback(() => {
    setOpenMenu(null);
    onExportFile();
  }, [onExportFile]);

  const handleOpenImport = useCallback(() => {
    setOpenMenu(null);
    fileInputRef.current?.click();
  }, []);

  const handleOpenHelp = useCallback(() => {
    setOpenMenu(null);
    onOpenHelp();
  }, [onOpenHelp]);

  /**
   * 読み込みは現在の回路を置き換え、Undo でも戻せないため、空でなければ確認する。
   */
  const handleImportChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      if (
        componentCount > 0 &&
        !window.confirm(
          `いまの回路（部品 ${componentCount} 個）を「${file.name}」で置き換えます。元に戻せません。続けますか？`,
        )
      ) {
        return;
      }
      void onImportFile(file);
    },
    [componentCount, onImportFile],
  );

  const renderAlignmentItems = () =>
    ALIGN_MENU_ITEMS.map((item) => (
      <button
        key={item.mode}
        type="button"
        role="menuitem"
        className={styles.menuItem}
        disabled={!canRunAlign(item.mode, selectedComponentIds.length)}
        title={item.description}
        onClick={() => handleAlign(item.mode)}
      >
        <span className={styles.menuIcon} aria-hidden>
          {item.icon}
        </span>
        {item.label}
      </button>
    ));

  return (
    <header
      ref={toolbarRef}
      className={styles.toolbar}
      data-compact={compact || undefined}
    >
      {!compact && <span className={styles.brand}>{APP_NAME}</span>}

      <div className={styles.group}>
        <button
          type="button"
          className={styles.run}
          onClick={start}
          disabled={running}
          title="回路を解いて通電状態を表示します（S キーでも可）"
          aria-label="シミュレーション開始"
        >
          {compact ? "▶" : "▶ 開始"}
        </button>
        <button
          type="button"
          className={styles.button}
          onClick={stop}
          disabled={!running}
          title="シミュレーションを停止し、押下状態と励磁状態を捨てます（S キーでも可）"
          aria-label="シミュレーション停止"
        >
          {compact ? "■" : "■ 停止"}
        </button>
        {running && (
          <span
            className={styles.status}
            data-status={currentStatus}
            title={STATUS_TITLE[currentStatus]}
          >
            {STATUS_LABEL[currentStatus]}
          </span>
        )}
        {running && hasTimers && !compact && (
          <span className={styles.elapsed}>{(nowMs / 1000).toFixed(1)} 秒</span>
        )}
        <button
          type="button"
          className={`${styles.button} ${styles.adaptiveButton}`}
          onClick={togglePathPreview}
          disabled={componentCount === 0}
          aria-pressed={pathPreview}
          data-active={pathPreview || undefined}
          title="動かさずに、電源から電位が届いている範囲と止まっている箇所を色で示します"
          aria-label="経路確認"
        >
          <span aria-hidden>⚡</span>
          {!compact && <span className={styles.adaptiveLabel}>経路</span>}
        </button>
        <button
          type="button"
          className={`${styles.button} ${styles.adaptiveButton}`}
          onClick={onOpenLadder}
          disabled={componentCount === 0}
          title="いまの配線をラダー図に変換して表示します（実端子番号のまま）"
          aria-label="ラダー図"
        >
          <span aria-hidden>⊞</span>
          {!compact && <span className={styles.adaptiveLabel}>ラダー</span>}
        </button>
      </div>

      <div className={styles.group}>
        <button
          type="button"
          className={styles.iconButton}
          onClick={undo}
          disabled={!canUndo}
          title="元に戻す（Ctrl/⌘ + Z）"
          aria-label="元に戻す"
        >
          ↶
        </button>
        <button
          type="button"
          className={styles.iconButton}
          onClick={redo}
          disabled={!canRedo}
          title="やり直す（Ctrl/⌘ + Shift + Z）"
          aria-label="やり直す"
        >
          ↷
        </button>
      </div>

      {!compact && (
        <div
          className={styles.menuWrap}
          data-toolbar-menu-root
        >
          <button
            ref={selectionTriggerRef}
            type="button"
            className={styles.menuTrigger}
            onClick={() => toggleMenu("selection")}
            aria-haspopup="menu"
            aria-expanded={openMenu === "selection"}
            data-active={openMenu === "selection" || undefined}
            title="範囲選択で拾う対象を切り替えます"
          >
            選択: {RANGE_SELECTION_SHORT_LABEL[rangeSelectionTarget]} ▾
          </button>
          {openMenu === "selection" && (
            <div
              className={`${styles.menu} ${styles.selectionMenu}`}
              role="menu"
              aria-label="範囲選択の対象"
            >
              <div className={styles.menuHeading}>範囲選択の対象</div>
              {RANGE_SELECTION_TARGETS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={rangeSelectionTarget === option.value}
                  className={styles.menuItem}
                  title={option.title}
                  onClick={() => {
                    onRangeSelectionTargetChange(option.value);
                    setOpenMenu(null);
                  }}
                >
                  <span className={styles.radioMark} aria-hidden>
                    {rangeSelectionTarget === option.value ? "●" : "○"}
                  </span>
                  {option.value === "both"
                    ? "部品＋配線"
                    : option.value === "components"
                      ? "部品のみ"
                      : "配線のみ"}
                </button>
              ))}
              <div className={styles.menuHint}>
                何もない所をドラッグすると範囲選択します。
              </div>
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        className={styles.button}
        onClick={removeSelected}
        disabled={selectedCount === 0}
        title="選択中の部品と配線を削除します（Delete / Backspace / D キーでも可）"
        aria-label="選択を削除"
      >
        {compact ? "削除" : "削除"}
        {selectedCount > 0 && ` (${selectedCount})`}
      </button>

      {!compact && (
        <>
          <div className={styles.menuWrap} data-toolbar-menu-root>
            <button
              ref={arrangeTriggerRef}
              type="button"
              className={styles.menuTrigger}
              onClick={() => toggleMenu("arrange")}
              disabled={componentCount === 0}
              aria-haspopup="menu"
              aria-expanded={openMenu === "arrange"}
              data-active={openMenu === "arrange" || undefined}
              title="自動整列と、選択部品の位置揃えをまとめて表示します"
            >
              ▦ 整列 ▾
            </button>
            {openMenu === "arrange" && (
              <div
                className={`${styles.menu} ${styles.arrangeMenu}`}
                role="menu"
                aria-label="整列"
              >
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  onClick={handleAutoArrange}
                  title="部品をグリッドに揃え、行・列を整え、重なりをほどきます（L キーでも可）"
                >
                  <span className={styles.menuIcon} aria-hidden>▦</span>
                  {selectedComponentIds.length > 0
                    ? "選択を自動整列"
                    : "全体を自動整列"}
                </button>
                <div className={styles.menuDivider} role="separator" />
                <div className={styles.menuHeading}>選択部品を揃える</div>
                <div className={styles.alignGrid}>{renderAlignmentItems()}</div>
                {!canAlign && (
                  <div className={styles.menuHint}>位置揃えは部品を2個以上選択すると使えます。</div>
                )}
              </div>
            )}
          </div>

          <div className={styles.menuWrap} data-toolbar-menu-root>
            <button
              ref={viewTriggerRef}
              type="button"
              className={styles.menuTrigger}
              onClick={() => toggleMenu("view")}
              aria-haspopup="menu"
              aria-expanded={openMenu === "view"}
              data-active={openMenu === "view" || undefined}
              title="表示に関する操作"
            >
              表示 ▾
            </button>
            {openMenu === "view" && (
              <div
                className={`${styles.menu} ${styles.smallMenu}`}
                role="menu"
                aria-label="表示"
              >
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  onClick={handleFitView}
                  title="回路全体が収まるように表示します"
                >
                  <span className={styles.menuIcon} aria-hidden>⤢</span>
                  全体表示
                </button>
              </div>
            )}
          </div>

          <div className={styles.menuWrap} data-toolbar-menu-root>
            <button
              ref={fileTriggerRef}
              type="button"
              className={styles.menuTrigger}
              onClick={() => toggleMenu("file")}
              aria-haspopup="menu"
              aria-expanded={openMenu === "file"}
              data-active={openMenu === "file" || undefined}
              title="回路ファイルの読み込み・書き出し"
            >
              ファイル ▾
            </button>
            {openMenu === "file" && (
              <div
                className={`${styles.menu} ${styles.menuEnd} ${styles.smallMenu}`}
                role="menu"
                aria-label="ファイル"
              >
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  onClick={handleExport}
                  disabled={componentCount === 0}
                  title="いまの回路を JSON ファイルに書き出します"
                >
                  <span className={styles.menuIcon} aria-hidden>⬇</span>
                  書き出し
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  onClick={handleOpenImport}
                  title="JSON ファイルから回路を読み込みます"
                >
                  <span className={styles.menuIcon} aria-hidden>⬆</span>
                  読み込み
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {compact ? (
        <div className={styles.metaGroup}>
          {saveStatus !== "saved" && saveStatus !== "pending" && (
            <span className={styles.save} data-status={saveStatus}>
              {SAVE_LABEL[saveStatus]}
            </span>
          )}
          <div className={styles.menuWrap} data-toolbar-menu-root>
            <button
              ref={moreTriggerRef}
              type="button"
              className={styles.iconButton}
              onClick={() => toggleMenu("more")}
              aria-haspopup="menu"
              aria-expanded={openMenu === "more"}
              data-active={openMenu === "more" || undefined}
              title="その他の操作"
              aria-label="その他の操作"
            >
              ⋯
            </button>
            {openMenu === "more" && (
              <div
                className={`${styles.menu} ${styles.menuEnd} ${styles.moreMenu}`}
                role="menu"
                aria-label="その他の操作"
              >
                <div className={styles.menuHeading}>配置</div>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  onClick={handleAutoArrange}
                  disabled={componentCount === 0}
                >
                  <span className={styles.menuIcon} aria-hidden>▦</span>
                  {selectedComponentIds.length > 0 ? "選択を自動整列" : "全体を自動整列"}
                </button>
                <div className={styles.alignGrid}>{renderAlignmentItems()}</div>
                <div className={styles.menuDivider} role="separator" />
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  onClick={handleFitView}
                >
                  <span className={styles.menuIcon} aria-hidden>⤢</span>
                  全体表示
                </button>
                <div className={styles.menuDivider} role="separator" />
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  onClick={handleExport}
                  disabled={componentCount === 0}
                >
                  <span className={styles.menuIcon} aria-hidden>⬇</span>
                  書き出し
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  onClick={handleOpenImport}
                >
                  <span className={styles.menuIcon} aria-hidden>⬆</span>
                  読み込み
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  onClick={handleOpenHelp}
                >
                  <span className={styles.menuIcon} aria-hidden>?</span>
                  使い方
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className={styles.metaGroup}>
          <button
            type="button"
            className={styles.help}
            onClick={onOpenHelp}
            title="操作一覧と、このシミュレーターが扱わないことを表示します"
            aria-label="使い方"
          >
            ?
          </button>
          <span className={styles.counts}>
            部品 {componentCount} ／ 配線 {connectionCount}
          </span>
          <span className={styles.save} data-status={saveStatus}>
            {SAVE_LABEL[saveStatus]}
          </span>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept={CIRCUIT_FILE_ACCEPT}
        className={styles.fileInput}
        onChange={handleImportChange}
        tabIndex={-1}
        aria-hidden
      />
    </header>
  );
}
