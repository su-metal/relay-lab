"use client";

/**
 * 全部品を描く唯一のノード（design.md §2）。
 *
 * `RelayNode` / `LampNode` のような型番・部品別コンポーネントは作らない。
 * このノードは `ComponentDefinition` を読んで、サイズ・端子・ラベルを組み立てる。
 * **新型番の追加が定義ファイル 1 枚で完結する**ことを UI 側で保証しているのがここ。
 */

import { NodeResizer, useUpdateNodeInternals } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import { memo, useEffect } from "react";

import type { DeviceNode as DeviceNodeType } from "@/circuit/adapter/reactflow";
import {
  deviceStatusOf,
  hasRealTerminalNumbers,
  modelSummaryOf,
  shortModelLabel,
} from "@/lib/component-display";
import { useCircuitStore } from "@/store/circuitStore";

import { DeviceTerminal } from "./DeviceTerminal";
import styles from "./DeviceNode.module.css";
import { bodyForCategory } from "./bodies";

function DeviceNodeComponent({ id, data, selected }: NodeProps<DeviceNodeType>) {
  const {
    definition,
    terminals,
    flipped,
    label,
    simulation,
    terminalStates,
    terminalVolts,
    terminalConnections,
    presetMs,
    lampColor,
    channelVolts,
    preview,
  } = data;
  const Body = bodyForCategory(definition.category);
  const showUnverified = !definition.verified && hasRealTerminalNumbers(definition);
  const status = deviceStatusOf(definition, simulation);
  const summary = modelSummaryOf(definition);

  const resizeComponent = useCircuitStore((state) => state.resizeComponent);
  const beginComponentResize = useCircuitStore(
    (state) => state.beginComponentResize,
  );
  const endComponentResize = useCircuitStore((state) => state.endComponentResize);

  /*
   * 端子の並びが変わったら React Flow に測り直させる（design.md §8.1）。
   * サイズ変更時は NodeResizer / ResizeObserver が handleBounds を更新する。
   * ここは左右反転や型番交換のように、寸法が同じまま端子 DOM だけが動く場合を
   * 補うための再計測である。
   */
  const terminalSignature = terminals
    .map(
      (terminal) =>
        `${terminal.id}:${terminal.side}:${terminal.position.x},${terminal.position.y}`,
    )
    .join("|");

  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, terminalSignature, updateNodeInternals]);

  return (
    <>
      {/*
        既定の visual 寸法をその型番の安全な最小値にする。
        端子番号・図記号・見出しは既定寸法で読めるよう設計されているため、
        そこより縮めなければリサイズで端子や内部レイアウトを潰さない。
      */}
      <NodeResizer
        isVisible={selected}
        minWidth={definition.visual.width}
        minHeight={definition.visual.height}
        keepAspectRatio={false}
        lineClassName={styles.resizeLine}
        handleClassName={styles.resizeHandle}
        onResizeStart={() => beginComponentResize()}
        onResize={(_event, params) =>
          resizeComponent(id, {
            x: params.x,
            y: params.y,
            width: params.width,
            height: params.height,
          })
        }
        onResizeEnd={() => endComponentResize()}
      />

      <div
        className={styles.node}
        data-category={definition.category}
        data-selected={selected ? "true" : undefined}
        data-flipped={flipped ? "true" : undefined}
        data-running={simulation ? "true" : undefined}
        data-preview-blocked={preview?.blocked ? "true" : undefined}
        data-energized={simulation?.energized ? "true" : undefined}
        data-self-hold={simulation?.selfHeld ? "true" : undefined}
        data-lit={simulation?.lit ? "true" : undefined}
      >
        <div className={styles.content}>
          <div className={styles.heading}>
            {label && <span className={styles.instanceLabel}>{label}</span>}
            <span className={styles.model}>
              {definition.manufacturer && (
                <span className={styles.manufacturer}>
                  {definition.manufacturer}{" "}
                </span>
              )}
              {shortModelLabel(definition.model)}
            </span>
            <span className={styles.modelTooltip} role="tooltip" aria-hidden>
              <span className={styles.modelTooltipTitle}>{summary.title}</span>
              {summary.lines.map((line) => (
                <span key={line} className={styles.modelTooltipLine}>
                  {line}
                </span>
              ))}
            </span>
          </div>
          <div className={styles.bodyArea}>
            <Body
              definition={definition}
              componentId={id}
              simulation={simulation}
              preview={preview}
              presetMs={presetMs}
              lampColor={lampColor}
              channelVolts={channelVolts}
            />
            {status && (
              <span
                className={styles.statusTooltip}
                data-active={status.active ? "true" : undefined}
                data-self-hold={status.selfHeld ? "true" : undefined}
                role="tooltip"
                aria-hidden
              >
                {status.label}
              </span>
            )}
          </div>
          {showUnverified && (
            <span className={styles.unverified} title={definition.source}>
              未検証
            </span>
          )}
        </div>

        {terminals.map((terminal) => (
          <DeviceTerminal
            key={terminal.id}
            terminal={terminal}
            state={terminalStates?.get(terminal.id)}
            volts={terminalVolts?.get(terminal.id)}
            connections={terminalConnections?.get(terminal.id)}
          />
        ))}
      </div>
    </>
  );
}

export const DeviceNode = memo(DeviceNodeComponent);
