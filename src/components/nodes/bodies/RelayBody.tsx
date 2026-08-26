import { RelayControls } from "./RelayControls";
import styles from "./bodies.module.css";
import type { BodyProps } from "./types";

/**
 * リレー。コイル記号・接点の図記号・仕様のキャプション。
 *
 * 接点構成は `contactSummaryOf()` から取る。MY2N（2c）でも G7L（1a / 2a）でも
 * このファイルは変わらない。**接点の形も型で決め打たない**（CLAUDE.md 設計原則 6）
 * —— `ncTerminal` の有無だけを見るので、b 接点の無いリレーには b 接点を描かない。
 *
 * 接点・操作子・キャプションは `RelayControls`（`DimmerBody` の `kind: "relay"`
 * 側と共用・design.md §4.17）に任せる。ここで持つのはコイル付きの図記号だけ。
 *
 * **停止中は静止状態（非励磁）の絵を描く。** これは「消磁している」という
 * 状態の主張ではなく、机の上に置いたリレーがそう見えるという事実
 * （`SwitchBody` が停止中も b 接点を閉じて描くのと同じ）。
 */
export function RelayBody({ definition, componentId, simulation }: BodyProps) {
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

      <RelayControls relay={relay} componentId={componentId} simulation={simulation} />
    </div>
  );
}
