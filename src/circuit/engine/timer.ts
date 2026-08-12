/**
 * 限時（タイマー）の状態遷移（design.md §5.13）。
 *
 * **ここには型番分岐も、時計も無い。**（CLAUDE.md 設計原則 1・2）
 * 動作は `TimerDelay.mode` の 2 値だけで決まり、「今が何 ms か」は
 * 呼び出し側から渡される。だから実時間に一切依存せず、テストは
 * `nowMs` を直接指定して境界（設定時間の 1ms 手前と丁度）を突ける。
 *
 * タイマーリレーは**遅れて動くリレー**なので、コイルの励磁判定そのものは
 * `relay.ts` の `evaluateCoil()` をそのまま使う。ここが受け持つのは
 * 「コイルの状態がいつ変わったか」と「接点が今どちらに倒れているか」だけ。
 */

import type {
  ElectricalDefinition,
  SimulationResult,
  TimerDelay,
  TimerState,
} from "@/circuit/types";

/**
 * その部品の**コイル**が今励磁しているか。
 *
 * **`energizedRelays` は「接点が切り替わっている」であってコイルではない**
 * （design.md §3.4）。遅延なしのリレーでは一致するが、オンディレイは
 * 設定時間のあいだ「コイルは入っているが接点はまだ動いていない」状態にいる。
 *
 * ここを取り違えると、**カウント中のタイマーのコイル配線が灰色（非通電）に
 * 見える。** 実際には電流が流れており、それがまさに時間を計っている最中なので、
 * 一番読みたい場所が消えることになる。
 */
export const coilEnergized = (
  result: Pick<SimulationResult, "energizedRelays" | "timers">,
  componentId: string,
  electrical: ElectricalDefinition,
): boolean => {
  if (electrical.kind !== "relay") return false;
  return electrical.delay
    ? result.timers.get(componentId)?.coilOn === true
    : result.energizedRelays.has(componentId);
};

/** まだ一度も評価していないタイマーの初期状態 */
export const initialTimerState = (): TimerState => ({
  coilOn: false,
  // **0 ではなく null。** 0 にすると、開始直後のオフディレイが
  // 「たった今入力が切れたところ」と読まれて接点が動いてしまう
  changedAtMs: null,
});

/**
 * コイルの状態が今の値になってからの経過時間。
 *
 * `changedAtMs === null`（開始からずっとこの値）は **∞** を返す。
 * オフディレイの「切れてから設定時間だけ保つ」に対して
 * 「とっくに経過している＝復帰済み」が自然に出る。
 */
export const elapsedMs = (state: TimerState, nowMs: number): number =>
  state.changedAtMs === null ? Number.POSITIVE_INFINITY : nowMs - state.changedAtMs;

/**
 * 前回の状態と今のコイルの状態から、タイマーの状態を進める。
 *
 * **コイルの状態が変わったときだけ時刻を打ち直す。** 毎回 `nowMs` を
 * 書き込むと経過時間が常に 0 になり、設定時間に到達しなくなる。
 *
 * @param previous 前回の `SimulationResult.timers` の値。初回は `undefined`
 */
export const advanceTimer = (
  previous: TimerState | undefined,
  coilOn: boolean,
  nowMs: number,
): TimerState => {
  if (!previous) {
    // 初回。コイルが既に入っているならこの瞬間に入ったものとして数え始める
    return coilOn
      ? { coilOn: true, changedAtMs: nowMs }
      : initialTimerState();
  }
  if (previous.coilOn === coilOn) return previous;
  return { coilOn, changedAtMs: nowMs };
};

/**
 * 接点が切り替わっているか（＝出力）。
 *
 * **状態として保持せず、必ずここで導く。** `TimerState` に出力を持たせると
 * コイルの状態・経過時間との三重管理になり、片方だけ更新されてずれる。
 *
 * - `on-delay`（限時動作）… 入力が入って設定時間**経ってから**動く。
 *   入力が切れたら即座に戻る
 * - `off-delay`（限時復帰）… 入力と**同時に**動き、切れてから設定時間
 *   そのまま保ってから戻る
 */
export const timerOutputOn = (
  delay: TimerDelay,
  state: TimerState,
  presetMs: number,
  nowMs: number,
): boolean => {
  const elapsed = elapsedMs(state, nowMs);
  return delay.mode === "on-delay"
    ? state.coilOn && elapsed >= presetMs
    : state.coilOn || elapsed < presetMs;
};

/**
 * 次にこのタイマーの接点が変わる時刻（ms）。カウント中でなければ `undefined`。
 *
 * 「カウント中」は出力がまだ変わっていない側にいる状態を指す。
 *
 * - `on-delay`: コイルが入っていて、まだ設定時間に達していない
 * - `off-delay`: コイルが切れていて、まだ設定時間に達していない
 *
 * **到達済みを除くために `nowMs` が要る。** コイルが入ったままのオンディレイは
 * 設定時間を過ぎても「コイルが入っている」ままなので、経過時間を見ずに返すと
 * **過去の時刻を永久に返し続け、ストアが時計を止められなくなる。**
 *
 * ストアはこの時刻の最小値を見て「まだ時計を進める必要があるか」を決める。
 * これが無いと、タイマーを 1 個も置いていない回路でも再計算を回し続ける。
 */
export const timerNextEventAtMs = (
  delay: TimerDelay,
  state: TimerState,
  presetMs: number,
  nowMs: number,
): number | undefined => {
  if (state.changedAtMs === null) return undefined;
  const counting = delay.mode === "on-delay" ? state.coilOn : !state.coilOn;
  if (!counting) return undefined;
  if (elapsedMs(state, nowMs) >= presetMs) return undefined;
  return state.changedAtMs + presetMs;
};

/**
 * インスタンスの設定時間を定義の範囲へ収める。
 *
 * **省略時は定義の既定値。** 保存データが壊れていても部品ごと捨てず、
 * 範囲へ倒す（`flipped` と同じ扱い・design.md §3.3）。
 */
export const presetMsOf = (
  delay: TimerDelay,
  presetMs: number | undefined,
): number => {
  if (presetMs === undefined || !Number.isFinite(presetMs)) {
    return delay.defaultPresetMs;
  }
  return Math.min(Math.max(presetMs, delay.minPresetMs), delay.maxPresetMs);
};
