"use client";

/**
 * 端子 1 個 = React Flow の Handle 1 個（design.md §8.1）。
 *
 * 本プロダクトの価値は「実端子番号どうしを繋ぐ」ことなので、
 * 端子の点だけでなく **番号ラベルを必ず添えて描く。**
 */

import { Handle, Position } from "@xyflow/react";

import { handleIdOf } from "@/circuit/adapter/reactflow";
import type { WireState } from "@/circuit/adapter/simulation-view";
import type { TerminalDefinition, TerminalSide } from "@/circuit/types";

import styles from "./DeviceTerminal.module.css";

/** 端子が出ている辺 → React Flow の Handle の向き */
const HANDLE_POSITION: Record<TerminalSide, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
};

type Props = {
  terminal: TerminalDefinition;
  /**
   * シミュレーション中の電位状態。停止中は `undefined`。
   * 端子と配線を同じ色にしないと、接点の先で色が途切れて配線が切れて見える。
   */
  state?: WireState;
};

export function DeviceTerminal({ terminal, state }: Props) {
  return (
    <div
      className={styles.terminal}
      data-side={terminal.side}
      data-role={terminal.role}
      data-state={state}
      style={{
        left: `${terminal.position.x * 100}%`,
        top: `${terminal.position.y * 100}%`,
      }}
    >
      <Handle
        // ConnectionMode.Loose で運用するため、端子はすべて source 1 個で足りる。
        // 端子に「入力 / 出力」の区別は無く、どちら向きにもドラッグできる（design.md §8.1）
        type="source"
        position={HANDLE_POSITION[terminal.side]}
        id={handleIdOf(terminal.id)}
        className={styles.handle}
        title={terminal.description ?? terminal.label}
      />
      <span className={styles.label} aria-hidden>
        {terminal.label}
      </span>
    </div>
  );
}
