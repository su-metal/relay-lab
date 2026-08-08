import styles from "./bodies.module.css";
import type { BodyProps } from "./types";

/**
 * 端子台。短絡バーで全極が渡っている様子を線で示す。
 *
 * 極数は `ElectricalDefinition.terminals.length` から取るので、
 * 8P・12P の端子台を足してもこのファイルは変わらない。
 */
export function TerminalBlockBody({ definition }: BodyProps) {
  const poles =
    definition.electrical.kind === "terminal"
      ? definition.electrical.terminals.length
      : definition.terminals.length;
  // 上下段に分かれた定義（design.md §4.5）なので、描くのは片側ぶんの極数
  const columns = Math.max(1, Math.round(poles / 2));

  return (
    <div className={styles.stack}>
      <svg
        className={styles.symbol}
        width="58"
        height="22"
        viewBox="0 0 58 22"
        aria-hidden
      >
        {/* 短絡バー。全端子が常時導通することを 1 本の線で表す */}
        <line x1="4" y1="11" x2="54" y2="11" />
        {Array.from({ length: columns }, (_, index) => (
          <circle
            key={index}
            className={styles.terminalScrew}
            cx={4 + ((54 - 4) * index) / Math.max(1, columns - 1)}
            cy="11"
            r="4"
          />
        ))}
      </svg>
      <span className={styles.caption}>{poles} 極／全端子導通</span>
    </div>
  );
}
