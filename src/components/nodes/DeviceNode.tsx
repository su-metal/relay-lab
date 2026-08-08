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
import { hasRealTerminalNumbers } from "@/lib/component-display";

import { DeviceTerminal } from "./DeviceTerminal";
import styles from "./DeviceNode.module.css";
import { bodyForCategory } from "./bodies";

function DeviceNodeComponent({ id, data, selected }: NodeProps<DeviceNodeType>) {
  const { definition, terminals, flipped, label, simulation, terminalStates } =
    data;
  const Body = bodyForCategory(definition.category);
  // 実端子番号を持つ型番だけがバッジの対象。汎用部品には検証すべき番号が無い
  const showUnverified = !definition.verified && hasRealTerminalNumbers(definition);

  /*
   * 反転したら React Flow に端子を測り直させる（design.md §8.1）。
   *
   * **これが無いと配線が端子から外れる。** React Flow は端子の座標
   * （handleBounds）をノードごとにキャッシュしており、更新するのは
   * ①ノードのサイズが変わったとき（ResizeObserver）②`type` /
   * `sourcePosition` / `targetPosition` が変わったとき の 2 つだけ。
   * 左右反転はそのどれにも当たらない — 寸法は同じまま、端子の DOM だけが
   * 反対側へ移る。結果、Edge は**反転前の位置**に貼り付いたまま残り、
   * 配線が部品から切れて見える（接続そのものは保たれている）。
   */
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, flipped, updateNodeInternals]);

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
      data-energized={simulation?.energized ? "true" : undefined}
      data-lit={simulation?.lit ? "true" : undefined}
      style={{
        width: definition.visual.width,
        height: definition.visual.height,
      }}
    >
      <div className={styles.content}>
        <div className={styles.heading}>
          {label && <span className={styles.instanceLabel}>{label}</span>}
          <span className={styles.model} title={definition.model}>
            {definition.manufacturer && (
              <span className={styles.manufacturer}>
                {definition.manufacturer}{" "}
              </span>
            )}
            {definition.model}
          </span>
        </div>
        <Body
          definition={definition}
          componentId={id}
          simulation={simulation}
        />
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
        />
      ))}
    </div>
  );
}

export const DeviceNode = memo(DeviceNodeComponent);
