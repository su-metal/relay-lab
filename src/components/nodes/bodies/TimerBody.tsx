import { inspectContacts } from "@/circuit/adapter/inspection";
import { presetMsOf } from "@/circuit/engine";

import { ContactDiagram } from "./ContactDiagram";
import styles from "./bodies.module.css";
import type { BodyProps } from "./types";

/** ミリ秒を "3.0 秒" の形にする。分をまたぐ設定でも読めるよう 60 秒で切り替える */
const formatSeconds = (ms: number): string =>
  ms >= 60_000
    ? `${Math.floor(ms / 60_000)}分${((ms % 60_000) / 1000).toFixed(0)}秒`
    : `${(ms / 1000).toFixed(1)}秒`;

/**
 * タイマーリレー（design.md §5.13）。
 *
 * リレーとの違いは**コイルと接点がずれる**ことだけなので、接点の図記号は
 * `ContactDiagram` をそのまま共有する。ここが受け持つのは
 * 「今どちらの状態にいるか」を 3 つに描き分けることだけ。
 *
 * | 状態 | 表示 |
 * |---|---|
 * | 入力なし | 設定時間だけ |
 * | 計測中（コイルは入ったが接点はまだ） | 残り時間 |
 * | 動作中（接点が動いた） | 動作中 |
 *
 * **計測中を独立した見た目にする。** ここを「まだ動いていない」と同じ絵に
 * すると、タイマーが動き出したのか配線を間違えたのかが画面から読めない ——
 * 待っている時間こそタイマーで一番見たいところ。
 */
export function TimerBody({ definition, simulation, presetMs }: BodyProps) {
  const electrical =
    definition.electrical.kind === "relay" ? definition.electrical : null;
  const relay = electrical?.relay ?? null;
  const timer = simulation?.timer;

  // 接点が切り替わっているか。コイルの状態（`timer.coilOn`）とは別物
  const switched = simulation?.energized ?? false;
  const contacts = relay ? inspectContacts(relay, switched) : [];

  const counting = timer?.remainingMs !== undefined;
  /*
   * 設定時間は**停止中も出す。** `simulation` はシミュレーション中しか無く、
   * 定義の既定値へ落とすと「2 秒に設定したのに 3 秒と書いてある」ことになる。
   * インスタンスの値（`presetMs`）を先に見て、範囲外は定義の上下限へ丸める。
   */
  const shownPresetMs = electrical?.delay
    ? presetMsOf(electrical.delay, timer?.presetMs ?? presetMs)
    : 0;

  return (
    <div className={styles.stack}>
      {/*
        コイル記号に砂時計を添える。リレーと同じ枠にしているのは、
        タイマーがリレーの一種であることを絵でも示すため（design.md §3.2）
      */}
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
          data-energized={timer?.coilOn ? "true" : undefined}
          x="10"
          y="5"
          width="32"
          height="16"
          rx="2"
        />
        {/* 砂時計。限時であることの目印 */}
        <path
          className={styles.timerGlass}
          d="M21 8 L31 8 L21 18 L31 18 Z"
        />
        <line x1="42" y1="13" x2="52" y2="13" />
      </svg>

      <ContactDiagram contacts={contacts} />

      {/*
        **3 つの状態を必ずどれか 1 つ出す。** 行を出し入れすると本体の高さが
        変わり、カウント中に文字が上下に動いて読めなくなる（design.md §8.1）
      */}
      {counting ? (
        <span className={styles.timerCounting}>
          残り {formatSeconds(timer?.remainingMs ?? 0)}
        </span>
      ) : switched ? (
        <span className={styles.energizedCaption}>動作中</span>
      ) : (
        <span className={styles.caption}>
          {electrical?.delay?.mode === "off-delay" ? "限時復帰" : "限時動作"}{" "}
          {formatSeconds(shownPresetMs)}
        </span>
      )}
    </div>
  );
}
