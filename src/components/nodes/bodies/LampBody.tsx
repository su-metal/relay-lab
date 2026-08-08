import styles from "./bodies.module.css";
import type { BodyProps } from "./types";

/**
 * 表示ランプ。JIS の表示灯記号（丸に×）。
 * 電圧はモデル名（"DC24V 表示ランプ"）に出るのでキャプションは重ねない。
 * 点灯時の発光表現は Step 4 で `lit` を足して行う。
 */
export function LampBody(_props: BodyProps) {
  return (
    <div className={styles.stack}>
      <svg
        className={styles.symbol}
        width="34"
        height="34"
        viewBox="0 0 34 34"
        aria-hidden
      >
        <circle className={styles.lampGlass} cx="17" cy="17" r="13" />
        <line x1="8" y1="8" x2="26" y2="26" />
        <line x1="26" y1="8" x2="8" y2="26" />
      </svg>
    </div>
  );
}
