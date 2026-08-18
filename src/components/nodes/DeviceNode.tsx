"use client";

/**
 * 全部品を描く唯一のノード（design.md §2）。
 *
 * `RelayNode` / `LampNode` のような型番・部品別コンポーネントは作らない。
 * このノードは `ComponentDefinition` を読んで、サイズ・端子・ラベルを組み立てる。
 * **新型番の追加が定義ファイル 1 枚で完結する**ことを UI 側で保証しているのがここ。
 */

import { useUpdateNodeInternals } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import { memo, useEffect } from "react";

import type { DeviceNode as DeviceNodeType } from "@/circuit/adapter/reactflow";
import {
  deviceStatusOf,
  hasRealTerminalNumbers,
  modelSummaryOf,
  shortModelLabel,
} from "@/lib/component-display";

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
    terminalConnections,
    presetMs,
    preview,
  } = data;
  const Body = bodyForCategory(definition.category);
  // 実端子番号を持つ型番だけがバッジの対象。汎用部品には検証すべき番号が無い
  const showUnverified = !definition.verified && hasRealTerminalNumbers(definition);
  // シミュレーション中の主要ステータス（励磁 / 点灯 / 押下）。図記号へのホバーで出す
  const status = deviceStatusOf(definition, simulation);
  // 見出し（型番）へのホバーで出す詳細。ノード内表示を削った分をここで補う
  const summary = modelSummaryOf(definition);

  /*
   * 端子の並びが変わったら React Flow に測り直させる（design.md §8.1）。
   *
   * **これが無いと配線が端子から外れる。** React Flow は端子の座標
   * （handleBounds）をノードごとにキャッシュしており、更新するのは
   * ①ノードのサイズが変わったとき（ResizeObserver）②`type` /
   * `sourcePosition` / `targetPosition` が変わったとき の 2 つだけ。
   * 左右反転（寸法は同じまま端子の DOM だけが反対側へ移る）も、
   * 部品交換（`replaceComponentDefinition`）で寸法が同じ型番へ移った場合も、
   * そのどちらにも当たらない。結果、Edge だけが**変更前の座標**に貼り付き、
   * 配線が部品から切れて見える（接続そのものは保たれている）。
   *
   * **依存には「測り直すべき条件」そのものを 1 本のキーで渡す。**
   * `flipped` や `definition.id` のような *要因* を並べる形にすると、
   * 端子配置を動かす要因が増えるたびに依存配列の長さが変わり、
   * Fast Refresh が「配列のサイズが変わった」と警告する（開発時のみ）。
   * ここで見たいのは要因ではなく結果 —— 実際に描く Handle の
   * ID・辺・位置が変わったか —— なので、それを文字列にして渡す。
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
    <div
      className={styles.node}
      data-category={definition.category}
      data-selected={selected ? "true" : undefined}
      // 図記号（SVG）だけを鏡像にするための目印。
      // 端子は `data.terminals` 側で既に反転済みで、文字は反転させない
      data-flipped={flipped ? "true" : undefined}
      // `simulation` の有無がそのまま「シミュレーション中か」を表す
      data-running={simulation ? "true" : undefined}
      // 経路確認モードで電位が止まっている部品（design.md §8.14）
      data-preview-blocked={preview?.blocked ? "true" : undefined}
      data-energized={simulation?.energized ? "true" : undefined}
      // 自分の接点で自分を保持しているリレー（design.md §5.9）。
      // 配線の紫を追わなくても、どのリレーが保持側かノード単体で分かる
      data-self-hold={simulation?.selfHeld ? "true" : undefined}
      data-lit={simulation?.lit ? "true" : undefined}
      style={{
        width: definition.visual.width,
        height: definition.visual.height,
      }}
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
          {/*
            見出しへのホバーで出す型番の詳細（正式名称・端子数・検証状態）。
            `.model` はノード幅に収めるため補足を削った短縮表示なので、
            削った分をここで補う。ネイティブ title は使わない（design.md §8.3）
          */}
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
          />
          {/*
            図記号へのホバーで出す主要ステータスの吹き出し。
            端子ツールチップ（DeviceTerminal）と同じく CSS の :hover だけで出し入れする
          */}
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
        {/* 未検証の端子データを検証済みに見せない（CLAUDE.md 設計原則 5） */}
        {showUnverified && (
          <span className={styles.unverified} title={definition.source}>
            未検証
          </span>
        )}
      </div>

      {/* 定義の端子ではなく、反転を織り込んだ `data.terminals` を描く */}
      {terminals.map((terminal) => (
        <DeviceTerminal
          key={terminal.id}
          terminal={terminal}
          state={terminalStates?.get(terminal.id)}
          connections={terminalConnections?.get(terminal.id)}
        />
      ))}
    </div>
  );
}

export const DeviceNode = memo(DeviceNodeComponent);
