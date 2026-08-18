"use client";

/**
 * 操作バー（上部）。
 *
 * ▶ / ■ でシミュレーションを開始・停止し、↶ / ↷ で操作を戻す・やり直す。
 * 収束の結果（`SimulationStatus`）と保存状態をここに出し、
 * 警告の一覧は右カラム下段の `WarningList` が受け持つ（design.md §8.4）。
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
 * 狭い画面での収束結果（design.md §8.12）。
 *
 * **意味は削らず、言い換えるだけ。** 「発振中」を落として「実行中」に
 * まとめてしまうと、ブザー回路が正常に動いているのか止まっているのかが
 * 読めなくなる。長い括弧書きだけを外す。
 */
const COMPACT_STATUS_LABEL: Record<SimulationStatus, string> = {
  stable: "実行中",
  oscillating: "発振中",
  "not-converged": "収束せず",
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
  /**
   * 狭い画面か（design.md §8.12）。ボタンの**数は減らさず名前だけを縮める。**
   * モバイルでは Delete キーも L キーも無いので、ここから消した操作は
   * 二度と辿り着けなくなる（唯一の例外は範囲選択の対象切り替え —— 指では
   * 枠そのものを引けないので設定する意味が無い）。
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * 「揃える」のメニュー（design.md §8.13）。
   *
   * `<dialog>` にはしない。ヘルプと違い**選択を保ったまま押せること自体が要件**で、
   * モーダルにするとフォーカスが移って「何を選んでいるか」が画面から消える。
   */
  const alignMenuRef = useRef<HTMLDivElement>(null);
  const alignTriggerRef = useRef<HTMLButtonElement>(null);
  const [alignOpen, setAlignOpen] = useState(false);

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

  /** 揃えるは 2 個から（`minimumSelection`）。均等の 3 個は項目ごとに見る */
  const canAlign = selectedComponentIds.length >= 2;

  /**
   * メニューを閉じる契機。**外側のクリック・Esc・選択が足りなくなったとき。**
   *
   * 選択を見ているのは、メニューを開いたままキャンバスで選び直すと
   * 「押せない項目だけが並んだメニュー」が残るため。
   */
  useEffect(() => {
    if (!alignOpen) return;
    if (!canAlign) {
      setAlignOpen(false);
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!alignMenuRef.current?.contains(event.target as Node)) {
        setAlignOpen(false);
      }
    };
    /**
     * **メニューを開いている間、その中の打鍵をキャンバスへ通さない。**
     * 通すと、項目にフォーカスがある状態で D を押しただけで選択が削除される。
     *
     * **`window` のキャプチャ段階で止める。** React の `onKeyDown` から
     * `stopPropagation()` しても効かない —— Next.js の App Router は
     * `document` 全体を React のルートにするので、React のリスナーと
     * React Flow の `deleteKeyCode`（`document` に載る）が**同じノード上**に
     * 並ぶ。同一ノードのリスナーは `stopPropagation()` では止まらない。
     * キャプチャ段階の `window` はそのどれよりも先に走る。
     *
     * 既定動作は妨げないので、Enter / Space での項目の実行と Tab 移動は
     * そのまま効く（止めているのは伝播だけで `preventDefault()` はしない）。
     */
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAlignOpen(false);
        // 閉じたあとの行き先を操作バーに戻す（項目は消えるのでフォーカスが宙に浮く）
        alignTriggerRef.current?.focus();
      }
      if (alignMenuRef.current?.contains(event.target as Node)) {
        event.stopPropagation();
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [alignOpen, canAlign]);

  const handleAlign = useCallback((mode: Parameters<typeof runAlign>[0]) => {
    runAlign(mode);
    // 押したら閉じる。続けて別の揃え方を試すときは開き直す —— 開きっぱなしだと
    // メニューがキャンバスを隠したまま部品が動き、結果が見えない
    setAlignOpen(false);
  }, []);

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
    <header className={styles.toolbar} data-compact={compact || undefined}>
      {/* アプリ名は狭い画面では畳む。操作に要らない唯一の要素なので最初に落とす */}
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
          {compact ? "▶ 開始" : "▶ シミュレーション開始"}
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
          <span className={styles.status} data-status={status ?? "stable"}>
            {(compact ? COMPACT_STATUS_LABEL : STATUS_LABEL)[status ?? "stable"]}
          </span>
        )}
        {/*
          経過時間（design.md §5.13）。**タイマーを置いた回路でだけ出す。**
          時間の概念が要らない回路にまで秒数を出すと、「時間で何かが変わる
          回路なのか」という誤った期待を持たせる。

          判定に `nextEventAtMs`（カウント中か）を使わないのは、計り終わるたびに
          表示が消えてちらつくため。**タイマーが置いてあるか**で決める。
        */}
        {running && hasTimers && (
          <span className={styles.elapsed}>{(nowMs / 1000).toFixed(1)} 秒</span>
        )}
        {/*
          経路確認（design.md §8.14）。**▶ の隣に置く。** 「動かす前に読む」
          操作なので、動かす操作と同じ場所に無いと存在に気付けない。

          押している間そのものが状態なので `aria-pressed` を持たせる。
          部品が 1 つも無いときは塗る対象が無いので押せない
        */}
        <button
          type="button"
          className={styles.button}
          onClick={togglePathPreview}
          disabled={componentCount === 0}
          aria-pressed={pathPreview}
          data-active={pathPreview || undefined}
          title="動かさずに、電源から電位が届いている範囲と止まっている箇所を色で示します"
          aria-label="経路確認"
        >
          {compact ? "⚡ 経路" : "⚡ 経路確認"}
        </button>
        {/*
          ラダー図（design.md §8.15）。**「読む」操作の並びに置く。**
          経路確認と同じく動かさずに回路を読むためのもので、
          配置や書き出しの隣にあると図面の編集操作に見える。

          部品が 1 つも無いときは段が 1 本も出ないので押せない
        */}
        <button
          type="button"
          className={styles.button}
          onClick={onOpenLadder}
          disabled={componentCount === 0}
          title="いまの配線をラダー図に変換して表示します（実端子番号のまま）"
          aria-label="ラダー図"
        >
          {compact ? "⊞ ラダー" : "⊞ ラダー図"}
        </button>
      </div>

      <div className={styles.group}>
        <button
          type="button"
          className={styles.button}
          onClick={undo}
          disabled={!canUndo}
          title="直前の操作を取り消します（Ctrl/⌘ + Z）"
          aria-label="元に戻す"
        >
          {compact ? "↶" : "↶ 元に戻す"}
        </button>
        <button
          type="button"
          className={styles.button}
          onClick={redo}
          disabled={!canRedo}
          title="取り消した操作をやり直します（Ctrl/⌘ + Shift + Z）"
          aria-label="やり直す"
        >
          {compact ? "↷" : "↷ やり直す"}
        </button>
      </div>

      {/*
        範囲選択の対象（design.md §8.6）。**狭い画面では出さない。**
        指では枠そのものを引けず（1 本指のドラッグは画面移動・§8.12）、
        設定しても効く場面が無い
      */}
      {!compact && (
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
      )}

      <div className={styles.group}>
        <button
          type="button"
          className={styles.button}
          onClick={removeSelected}
          disabled={selectedCount === 0}
          title="選択中の部品と配線を削除します（Delete / Backspace / D キーでも可）"
          aria-label="選択を削除"
        >
          {/*
            **モバイルではこのボタンが唯一の削除手段。** Delete キーも D キーも
            無いので、狭くても短い名前に留めて必ず出す（design.md §8.12）
          */}
          {compact ? "削除" : "選択を削除"}
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
          aria-label={
            selectedComponentIds.length > 0 ? "選択を整列" : "配置を整列"
          }
        >
          ▦{" "}
          {compact
            ? "整列"
            : selectedComponentIds.length > 0
              ? "選択を整列"
              : "配置を整列"}
        </button>
        {/*
          選択した部品を揃える（design.md §8.13）。**自動整理とは別のボタンにする。**
          あちらは「描いた並びを崩さず整える」、こちらは「指定した基準へ意図的に
          動かす」で性格が違う。同じボタンに混ぜると L を押すたびに列が潰れる。

          8 種類あるのでメニューに畳む。操作バーへ直接並べると、狭い画面で
          折り返しが増えてキャンバスが削られる（§8.12）。
        */}
        <div className={styles.menuWrap} ref={alignMenuRef}>
          <button
            ref={alignTriggerRef}
            type="button"
            className={styles.button}
            onClick={() => setAlignOpen((open) => !open)}
            disabled={!canAlign}
            aria-haspopup="menu"
            aria-expanded={alignOpen}
            data-active={alignOpen || undefined}
            title={
              canAlign
                ? "選択した部品を、指定した基準へ揃えます。Undo 1 回で元に戻せます"
                : "部品を 2 個以上選ぶと使えます"
            }
            aria-label="選択を揃える"
          >
            ⇤ 揃える ▾
          </button>
          {alignOpen && (
            <div
              className={styles.menu}
              role="menu"
              aria-label="選択を揃える"
            >
              {ALIGN_MENU_ITEMS.map((item) => (
                <button
                  key={item.mode}
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  // 均等だけは 3 個要る。押せない理由は `title` に書いてある
                  disabled={
                    !canRunAlign(item.mode, selectedComponentIds.length)
                  }
                  title={item.description}
                  onClick={() => handleAlign(item.mode)}
                >
                  <span className={styles.menuIcon} aria-hidden>
                    {item.icon}
                  </span>
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          className={styles.button}
          onClick={handleFitView}
          title="回路全体が収まるように表示します"
          aria-label="全体表示"
        >
          {compact ? "全体" : "全体表示"}
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
          aria-label="書き出し"
        >
          {compact ? "⬇" : "⬇ 書き出し"}
        </button>
        <button
          type="button"
          className={styles.button}
          onClick={() => fileInputRef.current?.click()}
          title="JSON ファイルから回路を読み込みます（いまの回路は置き換わります）"
          aria-label="読み込み"
        >
          {compact ? "⬆" : "⬆ 読み込み"}
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

      {/*
        操作ヘルプ（design.md §8.10）。D / F / L や「画面移動は Shift+ドラッグ」は
        画面のどこにも書かれておらず、知らなければ辿り着けない。
      */}
      <button
        type="button"
        className={styles.help}
        onClick={onOpenHelp}
        title="操作一覧と、このシミュレーターが扱わないことを表示します"
        aria-label="使い方"
      >
        ?
      </button>

      {/* 部品数・配線数は操作ではなく目安。狭い画面では場所を譲る */}
      {!compact && (
        <span className={styles.counts}>
          部品 {componentCount} ／ 配線 {connectionCount}
        </span>
      )}

      {/*
        保存状態（design.md §8.4）。狭い画面では**「保存済み」だけを畳む。**
        自動保存が効いている間は黙っていてよいが、保存できない環境を黙るのは
        別問題 —— リロードで回路が消えて初めて気付くことになる
      */}
      {(!compact || (saveStatus !== "saved" && saveStatus !== "pending")) && (
        <span className={styles.save} data-status={saveStatus}>
          {SAVE_LABEL[saveStatus]}
        </span>
      )}
    </header>
  );
}
