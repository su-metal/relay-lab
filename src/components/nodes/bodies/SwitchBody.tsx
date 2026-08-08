import styles from "./bodies.module.css";
import type { BodyProps } from "./types";

/**
 * 押しボタン。a 接点（NO）は開いた線、b 接点（NC）は閉じた線で描く。
 * `contactType` を読むだけなので、型番が増えても分岐は増えない。
 * A/B の別はモデル名にも出るため、図記号側に文字は重ねない。
 *
 * 押下中の表現（Step 4）はこのボディに `pressed` を足して行う。
 */
export function SwitchBody({ definition }: BodyProps) {
  const electrical =
    definition.electrical.kind === "switch" ? definition.electrical : null;
  const normallyClosed = electrical?.contactType === "NC";

  return (
    <div className={styles.stack}>
      <svg
        className={styles.symbol}
        width="46"
        height="28"
        viewBox="0 0 46 28"
        aria-hidden
      >
        {/* 押しボタンの頭 */}
        <line x1="23" y1="0" x2="23" y2="6" />
        <line x1="15" y1="6" x2="31" y2="6" />
        {/* 接点。NC は水平に閉じ、NO は斜めに開く */}
        <line x1="2" y1="20" x2="14" y2="20" />
        {normallyClosed ? (
          <line x1="14" y1="20" x2="32" y2="20" />
        ) : (
          <line x1="14" y1="20" x2="32" y2="12" />
        )}
        <line x1="32" y1="20" x2="44" y2="20" />
        <line x1="23" y1="6" x2="23" y2="14" strokeDasharray="2 2" />
      </svg>
    </div>
  );
}
