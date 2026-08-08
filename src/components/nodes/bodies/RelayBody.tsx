import styles from "./bodies.module.css";
import type { BodyProps } from "./types";

/**
 * リレー。コイル記号と、接点数・コイル仕様のキャプション。
 *
 * 接点数は `RelayDefinition.contacts.length` から取る。MY2N（2c）を足しても
 * このファイルは変わらない。励磁状態の表現は Step 4。
 */
export function RelayBody({ definition }: BodyProps) {
  const relay =
    definition.electrical.kind === "relay" ? definition.electrical.relay : null;

  return (
    <div className={styles.stack}>
      <svg
        className={styles.symbol}
        width="52"
        height="26"
        viewBox="0 0 52 26"
        aria-hidden
      >
        <line x1="0" y1="13" x2="10" y2="13" />
        <rect
          className={styles.relayCoil}
          x="10"
          y="5"
          width="32"
          height="16"
          rx="2"
        />
        <line x1="42" y1="13" x2="52" y2="13" />
      </svg>
      {relay && (
        <span className={styles.caption}>
          {relay.contacts.length}c ／ コイル {relay.coil.currentType}
          {relay.coil.voltage}V
        </span>
      )}
    </div>
  );
}
