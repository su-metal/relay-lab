"use client";

/**
 * 3 カラムレイアウト（design.md §8）と、狭い画面のシート切り替え（§8.12）。
 *
 * `ReactFlowProvider` をここで張っているのは、Toolbar（`fitView`）と
 * CircuitCanvas（`screenToFlowPosition`）、保存の復元（`setViewport`）が
 * 同じ React Flow インスタンスを共有する必要があるため。
 */

import { ReactFlowProvider, useReactFlow, useStoreApi } from "@xyflow/react";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";

import { getComponentDefinition } from "@/circuit/definitions";
import type { ComponentDefinition } from "@/circuit/types";
import { componentSizeOf } from "@/circuit/types";
import { useCircuitStore } from "@/store/circuitStore";
import { useSimulationStore } from "@/store/simulationStore";

import { CircuitCanvas } from "./CircuitCanvas";
import { ComponentPalette } from "./ComponentPalette";
import { HelpDialog } from "./HelpDialog";
import { LadderDialog } from "./LadderDialog";
import { PropertiesPanel } from "./PropertiesPanel";
import { Toolbar } from "./Toolbar";
import { PathPreviewList } from "./PathPreviewList";
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
  useSimulationSync();
  const persistence = useDocumentPersistence();
  useHistoryShortcuts();
  useFlipShortcut();
  useArrangeShortcut();
  useSimulationShortcut();

  const [rangeSelectionTarget, setRangeSelectionTarget] =
    useState<RangeSelectionTarget>("both");
  const [helpOpen, setHelpOpen] = useState(false);
  const [ladderOpen, setLadderOpen] = useState(false);

  const compact = useCompactLayout();
  const coarse = useCoarsePointer();

  const [openSheet, setOpenSheet] = useState<SheetKey | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(true);

  useEffect(() => {
    if (!compact) setOpenSheet(null);
  }, [compact]);

  const flowStore = useStoreApi();
  const { setViewport } = useReactFlow();
  const addComponent = useCircuitStore((state) => state.addComponent);
  const selectOnlyComponent = useCircuitStore(
    (state) => state.selectOnlyComponent,
  );

  const placeFromPalette = useCallback(
    (definition: ComponentDefinition) => {
      const { transform, width, height } = flowStore.getState();
      const [x, y, zoom] = transform;
      const { components } = useCircuitStore.getState().document;

      const occupied = components.map((component) => {
        const componentDefinition = getComponentDefinition(component.definitionId);
        const size = componentDefinition
          ? componentSizeOf(component, componentDefinition)
          : { width: 0, height: 0 };
        return { ...component.position, ...size };
      });

      const position = placeAtViewportCenter(
        { x, y, zoom },
        { width, height },
        definition.visual,
        occupied,
      );

      selectOnlyComponent(addComponent(definition, position));
      setOpenSheet(null);

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
      <PathPreviewList />
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
        onOpenLadder={() => setLadderOpen(true)}
      />

      {persistence.notices.length > 0 && (
        <LoadNotices
          notices={persistence.notices}
          onDismiss={persistence.dismissNotices}
        />
      )}

      <div
        className={styles.columns}
        data-inspector-collapsed={!compact && !inspectorOpen ? true : undefined}
      >
        {!compact && (
          <ComponentPalette
            onPick={coarse ? placeFromPalette : undefined}
          />
        )}

        <CircuitCanvas rangeSelectionTarget={rangeSelectionTarget} />

        {!compact && inspectorOpen && (
          <div className={styles.inspector}>
            <button
              type="button"
              className={styles.inspectorToggle}
              onClick={() => setInspectorOpen(false)}
              aria-label="プロパティパネルを閉じる"
              title="プロパティパネルを閉じる"
            >
              ›
            </button>
            {inspector}
          </div>
        )}

        {!compact && !inspectorOpen && (
          <aside className={styles.inspectorRail} aria-label="プロパティパネル">
            <button
              type="button"
              className={styles.inspectorToggle}
              onClick={() => setInspectorOpen(true)}
              aria-label="プロパティパネルを開く"
              title="プロパティパネルを開く"
            >
              ‹
            </button>
          </aside>
        )}

        {compact && openSheet && (
          <Sheet sheet={openSheet} onClose={() => setOpenSheet(null)}>
            {openSheet === "palette" && (
              <ComponentPalette onPick={placeFromPalette} />
            )}
            {openSheet === "properties" && <PropertiesPanel />}
            {openSheet === "diagnostics" && (
              <>
                <PathPreviewList />
                <WarningList />
              </>
            )}
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
      <LadderDialog open={ladderOpen} onClose={() => setLadderOpen(false)} />
    </div>
  );
}

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
