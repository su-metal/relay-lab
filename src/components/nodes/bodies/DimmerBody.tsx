import { outputVoltsOf } from "@/circuit/engine";

import styles from "./bodies.module.css";
import type { BodyProps } from "./types";

/**
 * 0–10V 調光出力（design.md §5.17）。
 *
 * 図記号は**斜めの傾き**（レベルが連続して変わることの目印）。接点の開閉でも
 * コイルの励磁でもない、この盤で唯一の「値を出す部品」であることが
 * 一目で分かる絵にする。
 *
 * **出す値は V で出し、% にはしない。** V → % の対応は受け側の機器が持つもので
 * （`AnalogCurve`）、順特性の機器を繋げば同じ 5V が別の明るさになる。
 * ここで % と書くと、逆特性という**受け側の性質**を出力側の性質だと読ませてしまう。
 *
 * **電圧は停止中も出す。** つまみの位置は ▶ を押さなくても決まっているもので、
 * タイマーの設定時間と同じ扱い（design.md §5.13）。
 */
export function DimmerBody({ definition, simulation, outputVolts }: BodyProps) {
  const electrical =
    definition.electrical.kind === "analog-source"
      ? definition.electrical
      : null;
  // 実行中は解いた値を、停止中はインスタンスの設定を出す（範囲外は定義が丸める）
  const volts =
    simulation?.outputVolts ??
    (electrical ? outputVoltsOf(electrical, outputVolts) : 0);

  return (
    <div className={styles.stack}>
      <svg
        className={styles.symbol}
        width="46"
        height="26"
        viewBox="0 0 46 26"
        aria-hidden
      >
        <rect x="7" y="4" width="32" height="18" rx="2" />
        {/* 連続して変わる量を表す斜線。接点の図記号と混ざらない形にしてある */}
        <line className={styles.dimmerRamp} x1="11" y1="18" x2="35" y2="8" />
      </svg>

      <span className={styles.dimmerLevel}>{volts.toFixed(1)}V</span>
    </div>
  );
}
