import styles from "./bodies.module.css";
import type { BodyProps } from "./types";

/**
 * 表示ランプ。JIS の表示灯記号（丸に×）。
 * 電圧はモデル名（"DC24V 表示ランプ"）に出るのでキャプションは重ねない。
 *
 * 点灯時はガラス部を塗って発光させる。色だけに頼らず光芒（drop-shadow）も
 * 併用するのは、要件書 §8 の「色覚に依存しない表現」に合わせるため。
 */
export function LampBody({ simulation }: BodyProps) {
  const lit = simulation?.lit ?? false;

  return (
    <div className={styles.stack}>
      <svg
        className={styles.symbol}
        width="34"
        height="34"
        viewBox="0 0 34 34"
        aria-hidden
      >
        <circle
          className={styles.lampGlass}
          data-lit={lit ? "true" : undefined}
          cx="17"
          cy="17"
          r="13"
        />
        <line x1="8" y1="8" x2="26" y2="26" />
        <line x1="26" y1="8" x2="8" y2="26" />
      </svg>
    </div>
  );
}
