import styles from "./bodies.module.css";
import type { BodyProps } from "./types";

/**
 * 専用ボディを持たないカテゴリのフォールバック。
 *
 * Step 7 で全 6 カテゴリに専用ボディが揃ったため、現在どのカテゴリからも
 * 参照されていない。**未知のカテゴリでも画面が壊れないことを保証するのが
 * このボディの役目**なので、使われていないからといって消さない。
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
