import { channelVoltsOf } from "@/circuit/engine";

import { OperationControls } from "./OperationControls";
import styles from "./bodies.module.css";
import type { BodyProps } from "./types";

/**
 * 調光の機器（design.md §5.17・§4.15）。
 *
 * 図記号は**斜めの傾き**（レベルが連続して変わることの目印）。接点の開閉でも
 * コイルの励磁でもない、この盤で唯一の「値を出す部品」であることが
 * 一目で分かる絵にする。
 *
 * **1 枚で 3 種類を描く。** 調光出力（`analog-source`）は出す電圧を、
 * 位相制御調光器（`dimmer`）は通した先の明るさを出す。図記号は同じで
 * よく、分けると斜線の角度や配色が片方だけずれる。
 *
 * **調光操作卓・ライトコントローラ（`kind: "relay"`）もここに来る。**
 * 探す場所（パレット）は調光だが、電気的にはコイルの無いリレーで、
 * 人が倒すフェーダー・スイッチを持つ（design.md §4.16・§4.17）。カテゴリは
 * ボディを選ぶだけで、`kind` が持つ操作子の絵まで決めてはいけない
 * （CLAUDE.md 設計原則 6）—— `RelayBody` と同じ `OperationControls` を
 * ここでも使い、フェーダー・スイッチの描き方を 2 箇所に分けない。
 */
export function DimmerBody({
  definition,
  componentId,
  simulation,
  channelVolts,
}: BodyProps) {
  const { electrical } = definition;

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

      {electrical.kind === "analog-source" && (
        <ChannelReadout
          definition={definition}
          simulation={simulation}
          channelVolts={channelVolts}
        />
      )}

      {electrical.kind === "dimmer" && <DimmerReadout simulation={simulation} />}

      {electrical.kind === "relay" && (
        <OperationControls
          operations={electrical.relay.operations}
          componentId={componentId}
        />
      )}
    </div>
  );
}

/**
 * 調光出力の読み。
 *
 * **出す値は V で出し、% にはしない。** V → % の対応は受け側の機器が持つもので
 * （`AnalogCurve`）、順特性の機器を繋げば同じ 5V が別の明るさになる。
 * ここで % と書くと、逆特性という**受け側の性質**を出力側の性質だと読ませてしまう。
 *
 * **電圧は停止中も出す。** つまみの位置は ▶ を押さなくても決まっているもので、
 * タイマーの設定時間と同じ扱い（design.md §5.13）。
 */
function ChannelReadout({
  definition,
  simulation,
  channelVolts,
}: Pick<BodyProps, "definition" | "simulation" | "channelVolts">) {
  const electrical =
    definition.electrical.kind === "analog-source"
      ? definition.electrical
      : null;
  if (!electrical) return null;

  // 実行中は解いた値を、停止中はインスタンスの設定を出す（範囲外は定義が丸める）
  const readings =
    simulation?.channelVolts ??
    electrical.channels.map((channel) => ({
      id: channel.id,
      label: channel.label,
      volts: channelVoltsOf(electrical, channel.id, channelVolts),
    }));

  // 1 回路の機器は 1 個の数字で読ませる。回路番号を添えても情報が増えない
  if (readings.length === 1) {
    return (
      <span className={styles.dimmerLevel}>{readings[0].volts.toFixed(1)}V</span>
    );
  }

  /*
   * 多回路の機器は回路番号つきで並べる。**1 個に潰さない** —— 16 回路を
   * 代表値 1 個にすると、どの回路を操作したのかが本体から読めなくなる。
   */
  return (
    <span className={styles.dimmerChannels}>
      {readings.map((reading) => (
        <span key={reading.id} className={styles.dimmerChannel}>
          <span className={styles.dimmerChannelId}>{reading.id}</span>
          {reading.volts.toFixed(1)}
        </span>
      ))}
    </span>
  );
}

/**
 * 位相制御調光器の読み。
 *
 * **こちらは % を出す。** 調光器は受け側の機器そのもので、V → % の対応を
 * 自分が持っている。出力回路に繋いだランプがどれだけ明るいかがこの値。
 *
 * **消えている理由を言い分ける。** 遮断されているのか、暗くしているだけ
 * なのかは盤を追うときにまったく別の話になる（`DimmingLevel.cutOff`）。
 */
function DimmerReadout({ simulation }: Pick<BodyProps, "simulation">) {
  const level = simulation?.dimming;
  if (!level) return null;

  return (
    <span className={styles.dimmerLevel}>
      {level.cutOff ? "遮断" : `${Math.round(level.percent)}%`}
    </span>
  );
}
