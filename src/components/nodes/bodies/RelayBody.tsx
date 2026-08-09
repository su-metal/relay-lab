import styles from "./bodies.module.css";
import type { BodyProps } from "./types";

/**
 * リレー。コイル記号と、接点数・コイル仕様のキャプション。
 *
 * 接点数は `RelayDefinition.contacts.length` から取る。MY2N（2c）を足しても
 * このファイルは変わらない。接点種別の呼称（c接点／a接点）は `contact.type` から
 * 決める。G7L（a接点のみ・SPST-NO）に「2c」と表示すると、実機に無い b 側が
 * あるかのように読めてしまうため、SPDT なら "c"、SPST-NO なら "a" を出し分ける。
 *
 * 励磁中はコイル枠を強調し、キャプションを「励磁中」に差し替える。
 * どの接点が切り替わったかは端子と配線の色で読み取れるので、
 * ここでは接点表を重ねない（詳細はプロパティパネル＝Step 5 の担当）。
 */
export function RelayBody({ definition, simulation }: BodyProps) {
  const relay =
    definition.electrical.kind === "relay" ? definition.electrical.relay : null;
  const energized = simulation?.energized ?? false;
  const contactKind =
    relay && relay.contacts.every((c) => c.type === "SPST-NO") ? "a" : "c";

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
            {relay.contacts.length}
            {contactKind} ／ コイル {relay.coil.currentType}
            {relay.coil.voltage}V
          </span>
        )
      )}
    </div>
  );
}
