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
import type { ConnectedTerminalInfo } from "@/circuit/adapter/terminal-connections";
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
  /**
   * この端子につながる配線の相手側一覧。配線が無ければ `undefined`。
   * ネットではなく配線そのもの（`buildTerminalConnections()`）なので、
   * スイッチ・端子台の導通で間接的につながる先までは含まない（design.md §8.3）。
   */
  connections?: readonly ConnectedTerminalInfo[];
};

/** 接続先 1 件ぶんの表示文言。「RY1 の端子 14」のように部品定義の警告文と揃える */
const connectionLabel = (info: ConnectedTerminalInfo): string =>
  `${info.componentName} の端子 ${info.terminalLabel}`;

export function DeviceTerminal({ terminal, state, connections }: Props) {
  // description は「端子 14 / コイル + / DC24V」の形で定義側が持っている。
  // 持たない端子でも最低限「端子 <ラベル>」は読めるようにする
  const tooltip = terminal.description ?? `端子 ${terminal.label}`;
  const connectionLines =
    connections && connections.length > 0
      ? connections.map(connectionLabel)
      : ["未接続"];

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
        // title（ネイティブのツールチップ）は使わない。下の .tooltip と二重に出るうえ、
        // 表示まで 1 秒近く待たされて「端子の意味をすぐ読める」体験にならない。
        // 読み上げ用には接続先も同じ本文に含める（design.md §8.3）
        aria-label={`${tooltip} / ${connectionLines.join("、")}`}
      />
      <span className={styles.label} aria-hidden>
        {terminal.label}
      </span>
      {/*
        ホバーで出す端子ツールチップ（design.md §8.3）。
        CSS の :hover だけで出し入れするので、端子 1 個ごとに React の状態を持たない。
        MY4N 1 個で 14 個並ぶため、ここに再レンダリングを増やしたくない
      */}
      <span className={styles.tooltip} role="tooltip" aria-hidden>
        <span className={styles.tooltipLine}>{tooltip}</span>
        {connectionLines.map((line, index) => (
          <span key={index} className={styles.tooltipConnectionLine}>
            {line}
          </span>
        ))}
      </span>
    </div>
  );
}
