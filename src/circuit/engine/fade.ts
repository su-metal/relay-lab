/**
 * フェード（時間をかけた明るさの変化・design.md §5.18）。
 *
 * **ここには型番分岐も、時計も無い**（CLAUDE.md 設計原則 1・2）。
 * 動きはフェード時間 1 つだけで決まり、「今が何 ms か」は呼び出し側から
 * 渡される。だから実時間に一切依存せず、テストは `nowMs` を直接指定して
 * 境界（フェード時間の 1ms 手前と丁度）を突ける。
 *
 * **`timer.ts` と同じ構えで書いてある。** 状態は「目標・開始値・開始時刻」の
 * 3 つだけで、**今出している電圧は持たずに導く** —— 保持すると三重管理になり、
 * 片方だけ更新されてずれる（`TimerState` が出力を持たないのと同じ理由）。
 *
 * **フェードするのは出力する電圧そのもの。** 受け側の入力段（`inputLevel()`）は
 * 何も知らないままで、来ている電圧を今までどおり % に直すだけ。実機でも
 * 時間をかけているのはコントローラであり、調光器は 0–10V に追従しているだけ
 * なので、**接点で 0V へ落とす配線（DIRECT）は瞬時のまま**になる ——
 * あれは機器の外の短絡で、出力段を通らない。
 *
 * V → % の変換もここには無い（CLAUDE.md 設計原則 9）。このファイルが扱うのは
 * 電圧だけで、逆特性かどうかは定義側の `AnalogCurve` が持っている。
 */

import type { FadeSpec, FadeState } from "@/circuit/types";

/**
 * まだ一度も評価していないチャンネルの初期状態。
 *
 * **目標値そのものから始める（`fromVolts === targetVolts`）。** 0V から
 * 這い上がらせると、▶ を押した瞬間に調光出力が下から上がってきて実機と
 * 食い違う —— 実機のコントローラは電源が入った時点で設定値を出している。
 *
 * `changedAtMs` は **`null`。** `TimerState` と同じ約束で「開始からずっと
 * この値」＝経過 ∞ を表し、「とっくに到達済み」が特別扱い無しに出る。
 */
export const initialFadeState = (targetVolts: number): FadeState => ({
  targetVolts,
  fromVolts: targetVolts,
  changedAtMs: null,
});

/**
 * 目標が今の値になってからの経過時間。
 *
 * `changedAtMs === null`（開始からずっとこの値）は **∞** を返す。
 * `elapsedMs()`（`timer.ts`）とまったく同じ形。
 */
export const fadeElapsedMs = (state: FadeState, nowMs: number): number =>
  state.changedAtMs === null ? Number.POSITIVE_INFINITY : nowMs - state.changedAtMs;

/**
 * 今この瞬間に出している電圧（V）。
 *
 * **状態として保持せず、必ずここで導く。** `FadeState` に現在値を持たせると
 * 目標・開始値・経過時間との四重管理になり、片方だけ更新されてずれる
 * （`timerOutputOn()` と同じ置き方）。
 *
 * フェード時間が 0 以下（＝フェードしない設定）なら常に目標値。割り算を
 * 通さないので 0 除算にもならない。
 */
export const fadeVoltsOf = (
  state: FadeState,
  fadeMs: number,
  nowMs: number,
): number => {
  if (fadeMs <= 0) return state.targetVolts;
  const elapsed = fadeElapsedMs(state, nowMs);
  if (elapsed >= fadeMs) return state.targetVolts;
  // 時刻が巻き戻った場合（負の経過）は開始値へ倒す。範囲外へ外挿しない
  if (elapsed <= 0) return state.fromVolts;
  const ratio = elapsed / fadeMs;
  return state.fromVolts + (state.targetVolts - state.fromVolts) * ratio;
};

/**
 * 前回の状態と今の目標電圧から、フェードを進める。
 *
 * **目標が変わったときだけ時刻を打ち直す。** 毎回 `nowMs` を書き込むと
 * 経過時間が常に 0 になり、いつまでも開始値のまま動かない
 * （`advanceTimer()` と同じ落とし穴）。
 *
 * **打ち直すときの `fromVolts` は「前の目標」ではなく「今の実効電圧」。**
 * 前の目標を入れると、**フェードの途中で設定を動かした瞬間に電圧が飛ぶ** ——
 * 3V→8V の途中（5V あたり）で 2V に変え直したら、5V から 2V へ向かうべきで
 * あって 3V から始め直すのでも 8V から落ちるのでもない。
 *
 * @param previous 前回の `SimulationResult.fades` の値。初回は `undefined`
 */
export const advanceFade = (
  previous: FadeState | undefined,
  targetVolts: number,
  fadeMs: number,
  nowMs: number,
): FadeState => {
  if (!previous) return initialFadeState(targetVolts);
  if (previous.targetVolts === targetVolts) return previous;
  return {
    targetVolts,
    fromVolts: fadeVoltsOf(previous, fadeMs, nowMs),
    changedAtMs: nowMs,
  };
};

/**
 * このチャンネルのフェードが終わる時刻（ms）。ランプ中でなければ `undefined`。
 *
 * **`timerNextEventAtMs()` と役割は同じだが、意味が「離散」から「連続」へ
 * 広がる。** タイマーが返すのは「その瞬間に接点が変わる時刻」で、それまでは
 * 何も起きない。フェードが返すのは「変わり終わる時刻」で、**そこまでのあいだ
 * 毎瞬値が動いている。**
 *
 * それでもストア側は 1 行も変わらない —— `simulationStore` はこの値を
 * 「まだ動いているか」の 1 ビットとしか読まず、刻みは固定の 50ms だから
 * （design.md §5.18）。途中の値は 50ms ごとの解き直しで `fadeVoltsOf()` が出す。
 *
 * **到達済みを除くために `nowMs` が要る。** 目標に届いたあとも状態は残るので、
 * 経過時間を見ずに返すと**過去の時刻を永久に返し続け、ストアが時計を
 * 止められなくなる**（`timerNextEventAtMs()` とまったく同じ理由）。
 */
export const fadeNextEventAtMs = (
  state: FadeState,
  fadeMs: number,
  nowMs: number,
): number | undefined => {
  if (fadeMs <= 0) return undefined;
  if (state.changedAtMs === null) return undefined;
  if (fadeElapsedMs(state, nowMs) >= fadeMs) return undefined;
  return state.changedAtMs + fadeMs;
};

/**
 * インスタンスのフェード時間を定義の範囲へ収める。
 *
 * **省略時は定義の既定値。** 保存データが壊れていても部品ごと捨てず、
 * 範囲へ倒す（`presetMsOf()` / `outputVoltsOf()` とまったく同じ形）。
 */
export const fadeMsOf = (fade: FadeSpec, fadeMs: number | undefined): number => {
  if (fadeMs === undefined || !Number.isFinite(fadeMs)) {
    return fade.defaultFadeMs;
  }
  return Math.min(Math.max(fadeMs, fade.minFadeMs), fade.maxFadeMs);
};
