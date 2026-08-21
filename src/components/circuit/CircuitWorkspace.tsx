"use client";

import { ReactFlowProvider, useReactFlow, useStoreApi } from "@xyflow/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode, TouchEvent as ReactTouchEvent } from "react";

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
import { usePanelShortcuts } from "./usePanelShortcuts";
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

type TouchGestureMode = "idle" | "pane" | "element" | "viewport";

/**
 * 1 本指で直接操作したい対象。
 *
 * 部品・端子・配線はもちろん、React Flow 内のボタンや凡例を触ったときまで
 * 「空きキャンバスのドラッグ」と誤認しないよう UI も含める。
 */
const TOUCH_ELEMENT_SELECTOR = [
  ".react-flow__node",
  ".react-flow__edge",
  ".react-flow__handle",
  ".react-flow__controls",
  ".react-flow__panel",
].join(",");

const isCanvasTouch = (target: EventTarget | null): target is Element =>
  target instanceof Element && target.closest(".react-flow") !== null;

const isCanvasElementTouch = (target: EventTarget | null): boolean =>
  isCanvasTouch(target) && target.closest(TOUCH_ELEMENT_SELECTOR) !== null;

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

  /**
   * タッチ操作の役割分担。
   *
   * React Flow / d3-zoom は `panOnDrag` が有効だと 1 本指でも Pane をパンする。
   * ただし 2 本指のピンチ／パンも同じ touch gesture を使うため、単純に
   * `panOnDrag={false}` にすると 2 本指まで殺してしまう。
   *
   * そこで touchstart は React Flow に通して gesture を登録させたまま、
   * **空きキャンバスから始まった 1 本指の touchmove だけ** capture で止める。
   * 2 本目が加わったら move を通すので、2 本指の中点移動＝画面パンと
   * ピンチ＝拡大縮小はそのまま動く。部品・端子・配線から始まった 1 本指は
   * `element` として一切止めず、ドラッグ／配線操作を優先する。
   */
  const touchGestureMode = useRef<TouchGestureMode>("idle");

  const onTouchStartCapture = useCallback(
    (event: ReactTouchEvent<HTMLDivElement>) => {
      if (!isCanvasTouch(event.target)) return;

      if (event.touches.length === 1) {
        touchGestureMode.current = isCanvasElementTouch(event.target)
          ? "element"
          : "pane";
        return;
      }

      if (
        event.touches.length >= 2 &&
        (touchGestureMode.current === "pane" ||
          touchGestureMode.current === "viewport")
      ) {
        touchGestureMode.current = "viewport";
      }
    },
    [],
  );

  const onTouchMoveCapture = useCallback(
    (event: ReactTouchEvent<HTMLDivElement>) => {
      if (!isCanvasTouch(event.target)) return;

      const mode = touchGestureMode.current;
      const blockSingleFingerPane = mode === "pane" && event.touches.length === 1;
      const blockSingleFingerAfterViewport =
        mode === "viewport" && event.touches.length < 2;

      if (blockSingleFingerPane || blockSingleFingerAfterViewport) {
        // React Flow の Pane へ届かせない。touchstart / touchend は通すことで
        // d3-zoom 側の gesture の開始・終了状態は壊さない。
        event.stopPropagation();
      }
    },
    [],
  );

  const onTouchEndCapture = useCallback(
    (event: ReactTouchEvent<HTMLDivElement>) => {
      // 2 本指から 1 本だけ離した直後も viewport のまま保持する。
      // 残った 1 本の move は上で止め、最後の 1 本が離れたら完全にリセットする。
      if (event.touches.length === 0) touchGestureMode.current = "idle";
    },
    [],
  );

  const onTouchCancelCapture = useCallback(() => {
    touchGestureMode.current = "idle";
  }, []);

  const [openSheet, setOpenSheet] = useState<SheetKey | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);

  const toggleComponentPanel = useCallback(() => {
    setPaletteOpen((current) => !current);
  }, []);

  const togglePropertiesPanel = useCallback(() => {
    setInspectorOpen((current) => !current);
  }, []);

  const toggleAllPanels = useCallback(() => {
    const open = !paletteOpen && !inspectorOpen;
    setPaletteOpen(open);
    setInspectorOpen(open);
  }, [inspectorOpen, paletteOpen]);

  usePanelShortcuts({
    compact,
    onToggleComponentPanel: toggleComponentPanel,
    onTogglePropertiesPanel: togglePropertiesPanel,
    onToggleAllPanels: toggleAllPanels,
  });

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

  const sidePanelsHidden = !paletteOpen && !inspectorOpen;

  return (
    <div className={styles.workspace} data-compact={compact || undefined}>
      <div className={styles.toolbarHost} data-compact={compact || undefined}>
        {!compact && (
          <button
            type="button"
            className={styles.allPanelsToggle}
            data-active={sidePanelsHidden ? true : undefined}
            onClick={toggleAllPanels}
            aria-pressed={sidePanelsHidden}
            aria-label={
              sidePanelsHidden
                ? "部品パネルとプロパティパネルを開く"
                : "部品パネルとプロパティパネルを閉じる"
            }
            title={
              sidePanelsHidden
                ? "左右のパネルを開く（M）"
                : "左右のパネルを閉じてメインだけ表示（M）"
            }
          >
            ▣
          </button>
        )}
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
      </div>

      {persistence.notices.length > 0 && (
        <LoadNotices
          notices={persistence.notices}
          onDismiss={persistence.dismissNotices}
        />
      )}

      <div
        className={styles.columns}
        data-palette-collapsed={!compact && !paletteOpen ? true : undefined}
        data-inspector-collapsed={!compact && !inspectorOpen ? true : undefined}
        onTouchStartCapture={onTouchStartCapture}
        onTouchMoveCapture={onTouchMoveCapture}
        onTouchEndCapture={onTouchEndCapture}
        onTouchCancelCapture={onTouchCancelCapture}
      >
        {!compact && paletteOpen && (
          <div className={styles.paletteRegion}>
            <button
              type="button"
              className={styles.paletteToggle}
              onClick={toggleComponentPanel}
              aria-label="部品パネルを閉じる"
              title="部品パネルを閉じる（C）"
            >
              ‹
            </button>
            <ComponentPalette onPick={coarse ? placeFromPalette : undefined} />
          </div>
        )}

        {!compact && !paletteOpen && inspectorOpen && (
          <aside className={styles.paletteRail} aria-label="部品パネル">
            <button
              type="button"
              className={styles.paletteToggle}
              onClick={toggleComponentPanel}
              aria-label="部品パネルを開く"
              title="部品パネルを開く（C）"
            >
              ›
            </button>
          </aside>
        )}

        <CircuitCanvas rangeSelectionTarget={rangeSelectionTarget} />

        {!compact && inspectorOpen && (
          <div className={styles.inspector}>
            <button
              type="button"
              className={styles.inspectorToggle}
              onClick={togglePropertiesPanel}
              aria-label="プロパティパネルを閉じる"
              title="プロパティパネルを閉じる（P）"
            >
              ›
            </button>
            {inspector}
          </div>
        )}

        {!compact && !inspectorOpen && paletteOpen && (
          <aside className={styles.inspectorRail} aria-label="プロパティパネル">
            <button
              type="button"
              className={styles.inspectorToggle}
              onClick={togglePropertiesPanel}
              aria-label="プロパティパネルを開く"
              title="プロパティパネルを開く（P）"
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
