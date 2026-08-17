"use client";

/**
 * 3 カラムレイアウト（design.md §8）と、狭い画面のシート切り替え（§8.12）。
 *
 * `ReactFlowProvider` をここで張っているのは、Toolbar（`fitView`）と
 * CircuitCanvas（`screenToFlowPosition`）、保存の復元（`setViewport`）が
 * 同じ React Flow インスタンスを共有する必要があるため。
 *
 * **中身を `Workspace` に分けているのはそのため。** プロバイダーを張った
 * コンポーネント自身は `useReactFlow()` を呼べないので、フックを使う層を
 * 1 段内側へ落としている。
 */

import { ReactFlowProvider, useReactFlow, useStoreApi } from "@xyflow/react";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";

import { getComponentDefinition } from "@/circuit/definitions";
import type { ComponentDefinition } from "@/circuit/types";
import { useCircuitStore } from "@/store/circuitStore";
import { useSimulationStore } from "@/store/simulationStore";

import { CircuitCanvas } from "./CircuitCanvas";
import { ComponentPalette } from "./ComponentPalette";
import { HelpDialog } from "./HelpDialog";
import { PropertiesPanel } from "./PropertiesPanel";
import { Toolbar } from "./Toolbar";
import { WarningList } from "./WarningList";
import { panToInclude, placeAtViewportCenter } from "./place-component";
import type { RangeSelectionTarget } from "./range-selection";
import { useArrangeShortcut } from "./useArrangeShortcut";
import { useDocumentPersistence } from "./useDocumentPersistence";
import { useFlipShortcut } from "./useFlipShortcut";
import { useHistoryShortcuts } from "./useHistoryShortcuts";
import { useSimulationShortcut } from "./useSimulationShortcut";
import { useSimulationSync } from "./useSimulationSync";
import { useCoarsePointer, useCompactLayout } from "./useViewportMode";
import { useWiringCheck } from "./useWiringCheck";
import styles from "./CircuitWorkspace.module.css";

/**
 * 狭い画面で下から出すパネル（design.md §8.12）。
 *
 * **並びは作業の順**（置く → 中身を見る → 指摘を読む）。左右のカラムを
 * そのまま横に並べ替えただけの順（部品・プロパティ・診断）と結果は同じだが、
 * 増やすときの基準はこちら。
 */
const SHEETS = [
  { key: "palette", label: "部品", title: "部品パレット" },
  { key: "properties", label: "プロパティ", title: "プロパティ" },
  { key: "diagnostics", label: "診断", title: "診断・配線チェック" },
] as const;

type SheetKey = (typeof SHEETS)[number]["key"];

export function CircuitWorkspace() {
  return (
    <ReactFlowProvider>
      <Workspace />
    </ReactFlowProvider>
  );
}

function Workspace() {
  // シミュレーションの再計算はここ 1 箇所からだけ駆動する（design.md §8.2）
  useSimulationSync();
  // 保存・復元も同じく 1 箇所（design.md §8.4）
  const persistence = useDocumentPersistence();
  useHistoryShortcuts();
  useFlipShortcut();
  // L キーで配置を整理する（design.md §8.9）。リスナーは 1 本だけ張る —
  // 操作バーのボタンは同じ `runAutoArrange` を直接呼ぶ
  useArrangeShortcut();
  // S キーでシミュレーションを開始・停止する（design.md §8.2）
  useSimulationShortcut();

  // 範囲選択の設定は画面の操作モードで、保存対象でも履歴の対象でもない。
  // circuitStore に混ぜず、操作バーとキャンバスがここで共有する（design.md §8.6）
  const [rangeSelectionTarget, setRangeSelectionTarget] =
    useState<RangeSelectionTarget>("both");

  // ヘルプの開閉も画面の状態。保存対象でも履歴の対象でもない（design.md §8.10）
  const [helpOpen, setHelpOpen] = useState(false);

  /**
   * 画面モード（design.md §8.12）。**幅と入力は別々に見る。**
   * 狭さはレイアウトを、指かどうかは置き方（D&D かタップか）を決める。
   */
  const compact = useCompactLayout();
  const coarse = useCoarsePointer();

  /** 狭い画面で開いているパネル。閉じているときは `null`（キャンバス全面） */
  const [openSheet, setOpenSheet] = useState<SheetKey | null>(null);

  // 窓を広げて 3 カラムへ戻ったらシートは畳む。開いたままにすると、
  // 次に狭くしたときに前回のパネルが勝手に開いて出てくる
  useEffect(() => {
    if (!compact) setOpenSheet(null);
  }, [compact]);

  const flowStore = useStoreApi();
  const { setViewport } = useReactFlow();
  const addComponent = useCircuitStore((state) => state.addComponent);
  const selectOnlyComponent = useCircuitStore(
    (state) => state.selectOnlyComponent,
  );

  /**
   * パレットのタップで部品を置く（design.md §8.12）。
   *
   * 指の端末には HTML5 の D&D が無いので、**タップだけで置ける経路**が要る。
   * 置き場所は「いま見えている範囲の真ん中」。座標の計算そのものは
   * `placeAtViewportCenter()`（純粋関数）が持つ。
   *
   * 置いたら選択してシートを閉じる。閉じないと、置いた部品がシートの裏に
   * 隠れて「タップしても何も起きない」ように見える。
   */
  const placeFromPalette = useCallback(
    (definition: ComponentDefinition) => {
      const { transform, width, height } = flowStore.getState();
      const [x, y, zoom] = transform;
      const { components } = useCircuitStore.getState().document;

      const position = placeAtViewportCenter(
        { x, y, zoom },
        { width, height },
        definition.visual,
        // 重なりは矩形で見る（左上だけ比べるとリレーの上に電源が乗る）
        components.map((component) => ({
          ...component.position,
          ...(getComponentDefinition(component.definitionId)?.visual ?? {
            width: 0,
            height: 0,
          }),
        })),
      );

      selectOnlyComponent(addComponent(definition, position));
      setOpenSheet(null);

      /*
       * 重なりを避けて右下へ流した部品は、携帯の幅ではすぐ画面の外に出る。
       * はみ出したぶんだけ画面を寄せる（倍率は変えない）。収まっていれば
       * `panToInclude` は同じ変換を返すので、そのときは動かさない ——
       * 置くたびに図面がわずかに揺れると、どこを見ていたのか見失う
       */
      const panned = panToInclude({ x, y, zoom }, { width, height }, {
        ...position,
        ...definition.visual,
      });
      if (panned.x !== x || panned.y !== y) {
        void setViewport(panned, { duration: 160 });
      }
    },
    [addComponent, flowStore, selectOnlyComponent, setViewport],
  );

  const inspector = (
    <>
      <PropertiesPanel />
      <WarningList />
    </>
  );

  return (
    <div className={styles.workspace} data-compact={compact || undefined}>
      <Toolbar
        compact={compact}
        saveStatus={persistence.status}
        rangeSelectionTarget={rangeSelectionTarget}
        onRangeSelectionTargetChange={setRangeSelectionTarget}
        onExportFile={persistence.exportToFile}
        onImportFile={persistence.importFromFile}
        onOpenHelp={() => setHelpOpen(true)}
      />

      {persistence.notices.length > 0 && (
        <LoadNotices
          notices={persistence.notices}
          onDismiss={persistence.dismissNotices}
        />
      )}

      <div className={styles.columns}>
        {/*
          狭い画面ではキャンバスだけを残し、両脇のカラムはシートへ畳む
          （design.md §8.12）。**畳んだパネルは描かない** —— 表示だけ消して
          残すと、プロパティと診断がキャンバスの裏で解き続ける
        */}
        {!compact && (
          <ComponentPalette
            onPick={coarse ? placeFromPalette : undefined}
          />
        )}

        <CircuitCanvas rangeSelectionTarget={rangeSelectionTarget} />

        {!compact && <div className={styles.inspector}>{inspector}</div>}

        {compact && openSheet && (
          <Sheet sheet={openSheet} onClose={() => setOpenSheet(null)}>
            {openSheet === "palette" && (
              <ComponentPalette onPick={placeFromPalette} />
            )}
            {openSheet === "properties" && <PropertiesPanel />}
            {openSheet === "diagnostics" && <WarningList />}
          </Sheet>
        )}
      </div>

      {compact && (
        <SheetTabs
          open={openSheet}
          onToggle={(key) =>
            setOpenSheet((current) => (current === key ? null : key))
          }
        />
      )}

      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}

/**
 * 下から出すパネル（design.md §8.12）。
 *
 * 中身（パレット / プロパティ / 診断）は 3 カラムのときと同じものをそのまま
 * 入れる。**モバイル用に別のパネルを作らない** —— 2 つに分けると、片方だけ
 * 直す事故が起きる。見出しも中身が持っているので、ここでは付けない。
 */
function Sheet({
  sheet,
  onClose,
  children,
}: {
  sheet: SheetKey;
  onClose: () => void;
  children: ReactNode;
}) {
  const meta = SHEETS.find((entry) => entry.key === sheet);

  return (
    <section className={styles.sheet} aria-label={meta?.title}>
      {/*
        閉じるボタンは**見出しの帯を作らずに右上へ重ねる**（design.md §8.12）。
        横向きの携帯ではシートに使える高さが 200px を切り、帯 1 本（28px）が
        部品 1 件ぶんに相当する。中身のパネルは自分の見出しを持っているので、
        シート側で見出しを繰り返す理由も無い
      */}
      <button
        type="button"
        className={styles.sheetClose}
        onClick={onClose}
        aria-label="パネルを閉じる"
      >
        ×
      </button>
      <div className={styles.sheetBody}>{children}</div>
    </section>
  );
}

/**
 * 画面下のタブ（design.md §8.12）。
 *
 * **畳んだパネルの中身を数で見せる。** 3 カラムなら常に目に入っている
 * 「選択中の部品」と「指摘の件数」が、シートを閉じている間はまったく
 * 見えなくなる。短絡を出したまま気付かずに配線を続ける状態を作らない。
 *
 * 診断の件数を取るためにここでも `useWiringCheck()` を呼ぶ（`WarningList` と
 * 二重に解く）。**狭い画面でシートを開けている間だけ**の重複で、`inspectWiring`
 * は端子数に線形なので許容する。
 */
function SheetTabs({
  open,
  onToggle,
}: {
  open: SheetKey | null;
  onToggle: (key: SheetKey) => void;
}) {
  const selectedCount = useCircuitStore(
    (state) => state.selectedComponentIds.length,
  );
  const result = useSimulationStore((state) => state.result);
  const wiringCheck = useWiringCheck();
  const warnings = result ? result.warnings : wiringCheck;
  const hasError = warnings.some((warning) => warning.severity === "error");

  const badgeOf = (key: SheetKey): number =>
    key === "properties" ? selectedCount : key === "diagnostics" ? warnings.length : 0;

  return (
    <nav className={styles.tabs} aria-label="パネルの切り替え">
      {SHEETS.map((sheet) => {
        const badge = badgeOf(sheet.key);
        return (
          <button
            key={sheet.key}
            type="button"
            className={styles.tab}
            data-active={open === sheet.key || undefined}
            aria-pressed={open === sheet.key}
            onClick={() => onToggle(sheet.key)}
          >
            {sheet.label}
            {badge > 0 && (
              <span
                className={styles.tabBadge}
                data-severity={
                  sheet.key === "diagnostics" && hasError ? "error" : undefined
                }
              >
                {badge}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

/**
 * 読み込み時に捨てた要素の通知。
 *
 * **黙って捨てない。** 未知の型番の部品を落とせば回路は静かに欠けるので、
 * 何が読めなかったのかを一度だけ知らせる（要件 US-E）。
 */
function LoadNotices({
  notices,
  onDismiss,
}: {
  notices: readonly string[];
  onDismiss: () => void;
}) {
  const shown = notices.slice(0, 3);
  const hidden = notices.length - shown.length;

  return (
    <div className={styles.notices} role="status">
      <ul className={styles.noticeList}>
        {shown.map((notice, index) => (
          <li key={index}>{notice}</li>
        ))}
        {hidden > 0 && <li>他 {hidden} 件</li>}
      </ul>
      <button
        type="button"
        className={styles.noticeClose}
        onClick={onDismiss}
        aria-label="通知を閉じる"
      >
        ×
      </button>
    </div>
  );
}
