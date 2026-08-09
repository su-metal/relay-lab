"use client";

/**
 * 操作バー（上部）。
 *
 * ▶ / ■ でシミュレーションを開始・停止し、↶ / ↷ で操作を戻す・やり直す。
 * 収束の結果（`SimulationStatus`）と保存状態をここに出し、
 * 警告の一覧は右カラム下段の `WarningList` が受け持つ（design.md §8.4）。
 */

import { useReactFlow } from "@xyflow/react";
import { useCallback, useRef } from "react";
import type { ChangeEvent } from "react";

import { CIRCUIT_FILE_ACCEPT } from "@/circuit/persistence/document-file";
import type { SimulationStatus } from "@/circuit/types";
import { APP_NAME } from "@/lib/app-info";
import { useCircuitStore } from "@/store/circuitStore";
import { useSimulationStore } from "@/store/simulationStore";

import { runAutoArrange } from "./auto-arrange";
import { RANGE_SELECTION_TARGETS } from "./range-selection";
import type { RangeSelectionTarget } from "./range-selection";
import type { PersistenceStatus } from "./useDocumentPersistence";
import styles from "./Toolbar.module.css";

/**
 * 収束結果の表示文言（design.md §5.5）。
 *
 * **発振はエラーではない。** B 接点による自励発振（ブザー回路）は
 * 配線として正しくても必ず起きるので、挙動として提示する。
 */
const STATUS_LABEL: Record<SimulationStatus, string> = {
  stable: "実行中",
  oscillating: "発振中（ブザー動作）",
  "not-converged": "収束しません",
};

/**
 * 保存状態の表示（design.md §8.4）。
 *
 * 自動保存は目に見えないので、**保存できていない環境をここで必ず知らせる。**
 * 「保存済み」と出せない状況を黙っていると、リロードで回路が消えて初めて気付く。
 */
const SAVE_LABEL: Record<PersistenceStatus, string> = {
  loading: "読み込み中…",
  saved: "保存済み",
  pending: "保存中…",
  unavailable: "保存できません",
  error: "保存に失敗しました",
};

export type ToolbarProps = {
  saveStatus: PersistenceStatus;
  rangeSelectionTarget: RangeSelectionTarget;
  onRangeSelectionTargetChange: (value: RangeSelectionTarget) => void;
  onExportFile: () => void;
  onImportFile: (file: File) => Promise<void>;
};

export function Toolbar({
  saveStatus,
  rangeSelectionTarget,
  onRangeSelectionTargetChange,
  onExportFile,
  onImportFile,
}: ToolbarProps) {
  const { fitView } = useReactFlow();
  const fileInputRef = useRef<HTMLInputElement>(null);

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
  const start = useSimulationStore((state) => state.start);
  const stop = useSimulationStore((state) => state.stop);

  const selectedCount =
    selectedComponentIds.length + selectedConnectionIds.length;

  const handleFitView = useCallback(() => {
    void fitView({ padding: 0.2, duration: 200 });
  }, [fitView]);

  /**
   * 読み込みは**いまの回路を捨てる操作**で、`replaceDocument` は履歴も消すので
   * Undo で戻れない（design.md §7）。空でなければ必ず確認を取る。
   */
  const handleImportChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      // 同じファイルを続けて選び直せるようにする（value が同じだと change が出ない）
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

  return (
    <header className={styles.toolbar}>
      <span className={styles.brand}>{APP_NAME}</span>

      <div className={styles.group}>
        <button
          type="button"
          className={styles.run}
          onClick={start}
          disabled={running}
          title="回路を解いて通電状態を表示します"
        >
          ▶ シミュレーション開始
        </button>
        <button
          type="button"
          className={styles.button}
          onClick={stop}
          disabled={!running}
          title="シミュレーションを停止し、押下状態と励磁状態を捨てます"
        >
          ■ 停止
        </button>
        {running && (
          <span className={styles.status} data-status={status ?? "stable"}>
            {STATUS_LABEL[status ?? "stable"]}
          </span>
        )}
      </div>

      <div className={styles.group}>
        <button
          type="button"
          className={styles.button}
          onClick={undo}
          disabled={!canUndo}
          title="直前の操作を取り消します（Ctrl/⌘ + Z）"
        >
          ↶ 元に戻す
        </button>
        <button
          type="button"
          className={styles.button}
          onClick={redo}
          disabled={!canRedo}
          title="取り消した操作をやり直します（Ctrl/⌘ + Shift + Z）"
        >
          ↷ やり直す
        </button>
      </div>

      <div className={styles.group}>
        {/*
          何もない所を左ドラッグすれば常に範囲選択になるので、モードの切り替えは
          置かない。ここにあるのは枠が拾う対象だけ（design.md §8.6）。
          画面移動は Shift+ドラッグ・中／右ドラッグ・ホイール
        */}
        <span
          className={styles.groupLabel}
          title="何もない所をドラッグすると範囲選択します。画面を動かすときは Shift+ドラッグ（中ボタン／右ドラッグ・ホイールでも可）"
        >
          ⬚ 範囲選択
        </span>
        <div
          className={styles.segmented}
          role="group"
          aria-label="範囲選択の対象"
        >
          {RANGE_SELECTION_TARGETS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={styles.segment}
              onClick={() => onRangeSelectionTargetChange(option.value)}
              aria-pressed={rangeSelectionTarget === option.value}
              data-active={rangeSelectionTarget === option.value || undefined}
              title={option.title}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.group}>
        <button
          type="button"
          className={styles.button}
          onClick={removeSelected}
          disabled={selectedCount === 0}
          title="選択中の部品と配線を削除します（Delete / Backspace / D キーでも可）"
        >
          選択を削除
          {selectedCount > 0 && ` (${selectedCount})`}
        </button>
        {/*
          配置の自動整理（design.md §8.9）。対象は選択中があればそれだけ、
          無ければ全体 —— ラベルもそれに合わせて言い換える。
          「整列」とだけ書くと、囲んで押したときに図面全部が動くように読める
        */}
        <button
          type="button"
          className={styles.button}
          onClick={runAutoArrange}
          disabled={componentCount === 0}
          title="部品をグリッドに揃え、行・列を整え、重なりをほどきます（L キーでも可）。Undo 1 回で元に戻せます"
        >
          ▦ {selectedComponentIds.length > 0 ? "選択を整列" : "配置を整列"}
        </button>
        <button type="button" className={styles.button} onClick={handleFitView}>
          全体表示
        </button>
      </div>

      {/*
        回路の持ち出し（design.md §8.4）。LocalStorage の自動保存はこのブラウザの
        中だけなので、別の PC へ渡す・課題として提出する経路をここに置く。
      */}
      <div className={styles.group}>
        <button
          type="button"
          className={styles.button}
          onClick={onExportFile}
          disabled={componentCount === 0}
          title="いまの回路を JSON ファイルに書き出します"
        >
          ⬇ 書き出し
        </button>
        <button
          type="button"
          className={styles.button}
          onClick={() => fileInputRef.current?.click()}
          title="JSON ファイルから回路を読み込みます（いまの回路は置き換わります）"
        >
          ⬆ 読み込み
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={CIRCUIT_FILE_ACCEPT}
          className={styles.fileInput}
          onChange={handleImportChange}
          // ボタンから開くだけで、この input 自体は操作対象にしない
          tabIndex={-1}
          aria-hidden
        />
      </div>

      <span className={styles.counts}>
        部品 {componentCount} ／ 配線 {connectionCount}
      </span>
      <span className={styles.save} data-status={saveStatus}>
        {SAVE_LABEL[saveStatus]}
      </span>
    </header>
  );
}
