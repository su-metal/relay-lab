import styles from "./bodies.module.css";
import type { BodyProps } from "./types";

/**
 * 電源。電池記号（長線が +、短線が 0V）で向きを示す。
 * 電圧はモデル名（"DC24V 電源"）に出るのでキャプションは重ねない。
 */
export function PowerSupplyBody(_props: BodyProps) {
  return (
    <div className={styles.stack}>
      <svg
        className={styles.symbol}
        width="44"
        height="26"
        viewBox="0 0 44 26"
        aria-hidden
      >
        <line x1="0" y1="13" x2="14" y2="13" />
        <line className={styles.powerPlus} x1="17" y1="3" x2="17" y2="23" />
        <line className={styles.powerZero} x1="24" y1="8" x2="24" y2="18" />
        <line x1="27" y1="13" x2="44" y2="13" />
      </svg>
    </div>
  );
}
