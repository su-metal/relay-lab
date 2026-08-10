import { contactSummaryOf } from "@/lib/component-display";

import styles from "./bodies.module.css";
import type { BodyProps } from "./types";

/**
 * リレー。コイル記号と、接点構成・コイル仕様のキャプション。
 *
 * 接点構成は `contactSummaryOf()` から取る。MY2N（2c）でも G7L（1a / 2a）でも
 * このファイルは変わらない。
 *
 * 励磁中はコイル枠を強調し、キャプションを「励磁中」に差し替える。
 * どの接点が切り替わったかは端子と配線の色で読み取れるので、
 * ここでは接点表を重ねない（詳細はプロパティパネル＝Step 5 の担当）。
 */
export function RelayBody({ definition, simulation }: BodyProps) {
  const relay =
    definition.electrical.kind === "relay" ? definition.electrical.relay : null;
  const energized = simulation?.energized ?? false;

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
          data-energized={energized ? "true" : undefined}
          x="10"
          y="5"
          width="32"
          height="16"
          rx="2"
        />
        <line x1="42" y1="13" x2="52" y2="13" />
      </svg>
      {energized ? (
        <span className={styles.energizedCaption}>励磁中</span>
      ) : (
        relay && (
          <span className={styles.caption}>
            {contactSummaryOf(relay)} ／ コイル {relay.coil.currentType}
            {relay.coil.voltage}V
          </span>
        )
      )}
    </div>
  );
}
