import styles from "./bodies.module.css";
import type { BodyProps } from "./types";

/**
 * 端子台。同じ列の上段・下段が 1 対 1 で内部導通することを示す。
 *
 * 20P なら 1–11、2–12、…、10–20 の 10 組。異なる組どうしは独立している。
 */
export function TerminalBlockBody({ definition }: BodyProps) {
  const poles = definition.terminals.length;
  const pairs = Math.max(1, Math.floor(poles / 2));

  return (
    <div className={styles.stack}>
      <svg
        className={styles.symbol}
        width="58"
        height="28"
        viewBox="0 0 58 28"
        aria-hidden
      >
        {Array.from({ length: Math.min(pairs, 6) }, (_, index) => {
          const x = 5 + (48 * index) / Math.max(1, Math.min(pairs, 6) - 1);
          return (
            <g key={index}>
              <circle className={styles.terminalScrew} cx={x} cy="5" r="3" />
              <line x1={x} y1="8" x2={x} y2="20" />
              <circle className={styles.terminalScrew} cx={x} cy="23" r="3" />
            </g>
          );
        })}
      </svg>
      <span className={styles.caption}>
        {poles} 極／{pairs} 組・対向端子導通
      </span>
    </div>
  );
}
