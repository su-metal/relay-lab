import { DEFAULT_LAMP_COLOR } from "@/circuit/types";

import styles from "./bodies.module.css";
import type { BodyProps } from "./types";

/**
 * 表示ランプ。JIS の表示灯記号（丸に×）。
 * 電圧はモデル名（"DC24V 表示ランプ"）に出るのでキャプションは重ねない。
 *
 * 点灯時はガラス部を塗って発光させる。色だけに頼らず光芒（drop-shadow）も
 * 併用するのは、要件書 §8 の「色覚に依存しない表現」に合わせるため。
 *
 * **レンズの色は消灯中も出す**（design.md §4.11）。盤面では「赤＝異常・
 * 緑＝運転」のように色そのものが意味を持つので、▶ を押すまで何色のランプか
 * 分からないのでは図面として使えない。消灯中は同じ色相の淡い塗りにして、
 * 点灯（濃い塗り＋縁＋光芒）と見分けが付くようにする。
 *
 * **調光ランプは同じボディで描く**（design.md §5.17）。調光ランプはランプで
 * あって別種の部品ではなく、`dimming` を持つかどうかだけが違う。違うのは
 * 2 点 —— 塗りの濃さと光芒が明るさに比例することと、% を数字でも出すこと。
 *
 * **数字を必ず添えるのが要点。** 明るさを塗りの濃さだけで表すと、
 * 暗い側（この仕様では 10V 側）が「消灯」と見分けられない ——
 * 要件書 §8 の「色だけに依存しない」を、明るさの軸にも通す。
 */
export function LampBody({ simulation, lampColor }: BodyProps) {
  const lit = simulation?.lit ?? false;
  const dimming = simulation?.dimming;
  // 0–1 に正規化した明るさ。調光ランプ以外は 1（＝従来どおりの塗り）
  const brightness = dimming ? Math.max(0, Math.min(1, dimming.percent / 100)) : 1;

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
          data-color={lampColor ?? DEFAULT_LAMP_COLOR}
          style={{ "--brightness": brightness } as React.CSSProperties}
          cx="17"
          cy="17"
          r="13"
        />
        <line x1="8" y1="8" x2="26" y2="26" />
        <line x1="26" y1="8" x2="8" y2="26" />
      </svg>

      {/*
        明るさ（design.md §5.17）。**電源が来ていなくても出す** ——
        「0% だから消えている」と「電源が来ていないから消えている」は
        実機を触るときにまったく違う話で、数字が消えると区別できなくなる
      */}
      {dimming && (
        <span className={styles.dimmerLevel} data-lit={lit ? "true" : undefined}>
          {Math.round(dimming.percent)}%
        </span>
      )}
    </div>
  );
}
