import styles from "./bodies.module.css";
import type { BodyProps } from "./types";

/**
 * 専用ボディを持たないカテゴリのフォールバック。
 *
 * 現状はダイオードと端子台（Step 7 で `DiodeBody` / `TerminalBlockBody` を足す）。
 * **未知のカテゴリでも画面が壊れないことを保証するのがこのボディの役目。**
 */
export function GenericBody({ definition }: BodyProps) {
  return (
    <div className={styles.stack}>
      <svg
        className={styles.symbol}
        width="40"
        height="24"
        viewBox="0 0 40 24"
        aria-hidden
      >
        <rect x="6" y="4" width="28" height="16" rx="2" />
      </svg>
      <span className={styles.caption}>{definition.terminals.length} 端子</span>
    </div>
  );
}
