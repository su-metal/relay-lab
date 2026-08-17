/**
 * シミュレーションの入出力（design.md §3.4）。
 *
 * エンジンは Step 2 で実装する。ここでは境界の型だけを確定させる。
 */

export type SimulationInput = {
  /** 押下中の押しボタンの componentId（インスタンス ID） */
  pressedSwitches: ReadonlySet<string>;
  /**
   * 直前の励磁状態（前回の `SimulationResult.energizedRelays`）。収束計算の初期値になる。
   *
   * 自己保持回路はボタンを離した状態で「全 OFF」と「励磁継続」の 2 つが
   * ともに安定解になる双安定回路であり、どちらに落ちるかは直前の状態でしか決まらない。
   * 毎回すべて非励磁から解き直すと自己保持が再現できない（design.md §5.5）。
   * 省略時は全リレー非励磁から始める（新規回路・リセット時）。
   */
  previousEnergizedRelays?: ReadonlySet<string>;
  /**
   * シミュレーション開始からの経過ミリ秒（design.md §5.13）。省略時は 0。
   *
   * **時刻は入力として受け取る。** エンジンが `performance.now()` を呼ぶと
   * 純粋関数でなくなり（CLAUDE.md 設計原則 1）、テストが実時間に縛られる。
   * 時計を持つのは `simulationStore` だけ。
   */
  nowMs?: number;
  /**
   * 直前のタイマー状態（前回の `SimulationResult.timers`）。
   *
   * `previousEnergizedRelays` と同じ役割で、**渡し忘れると時間が進まない** ——
   * 毎回「今この瞬間に入力が入った」ところからやり直すので、
   * オンディレイの接点が永久に動かない。
   */
  previousTimers?: ReadonlyMap<string, TimerState>;
};

/**
 * タイマー 1 個の実行時状態（design.md §5.13）。
 *
 * **接点が動いているか（出力）は持たない。** `coilOn` と経過時間と設定時間から
 * 必ず導けるものを別に持つと、片方だけ更新されてずれる。導出は
 * `engine/timer.ts` の `timerOutputOn()` 1 箇所に置く。
 */
export type TimerState = {
  /** コイルに電圧がかかっているか（今この瞬間） */
  coilOn: boolean;
  /**
   * `coilOn` が今の値になった時刻（ms）。**`null` は「開始からずっとこの値」。**
   *
   * 0 で初期化してはいけない。オフディレイの出力は「入力が切れてから
   * 設定時間だけ保つ」なので、0 だと**開始直後にまだ一度も入力していない
   * タイマーの接点が動いてしまう。** `null` を経過時間 ∞ と読むことで、
   * 「切れてからずっと経っている＝とっくに復帰済み」が自然に出る。
   */
  changedAtMs: number | null;
};

/**
 * ネット（連結成分）の電位状態。
 *
 * 電圧値は持たない。「どの電源の + 側に届くか / どの電源の 0V 側に届くか」だけで
 * 導通と配線色を決める（design.md §5.6・§6-3）。
 *
 * **真偽値 2 個ではなく電源ごとの集合で持つ。** 2 ビットにすると
 * 「PS1 の +24V」と「PS2 の 0V」が区別できず、**基準を共有していない 2 台の
 * 電源をまたいだ負荷を通電と誤判定する**（実機では帰り道が無いので流れない）。
 * 0V コモンの繋ぎ忘れは実務で最も多い配線ミスの 1 つで、本来このツールが
 * 真っ先に捕まえるべきもの（design.md §5.3）。
 */
export type NetState = {
  /** このネットが届いている電源の + 側。値は電源部品のインスタンス ID */
  plusFrom: ReadonlySet<string>;
  /** このネットが届いている電源の 0V 側 */
  zeroFrom: ReadonlySet<string>;
};

/** 警告の種別（design.md §5.7 の 6 種に対応） */
export type WarningCode =
  /** +24V 端子と 0V 端子が導通している */
  | "power-short-circuit"
  /** コイルに逆極性で電圧がかかっている */
  | "coil-polarity-reversed"
  /**
   * ダイオードの向きが逆。
   * コイルと並列の逆起電力吸収ダイオードが逆向き、または
   * 負荷を挟まずに順方向で + と 0V をまたいでいる（design.md §5.4）
   */
  | "diode-reversed"
  /** どの接続にも現れない端子がある */
  | "unconnected-terminal"
  /**
   * コイルが自分自身の b 接点を通して給電されている。
   * 動作した瞬間に自分で給電を切るため実機では唸る（design.md §5.14）
   */
  | "coil-self-interrupt"
  /** 励磁状態が振動して収束しない（B 接点による自励発振） */
  | "oscillating"
  /** 反復上限に達しても安定しなかった */
  | "not-converged";

/**
 * 深刻度。
 *
 * 発振は配線として正しくても必ず起きる挙動（ブザー回路）なので、
 * エラーではなく "info" として提示できる必要がある（design.md §5.5）。
 */
export type WarningSeverity = "error" | "warning" | "info";

export type Warning = {
  code: WarningCode;
  severity: WarningSeverity;
  /** UI にそのまま出せる日本語の本文 */
  message: string;
  /** 該当する部品インスタンス ID（特定できる場合） */
  componentId?: string;
  /** 該当する端子 ID（特定できる場合） */
  terminalId?: string;
};

export type SimulationStatus = "stable" | "oscillating" | "not-converged";

export type SimulationResult = {
  /**
   * **接点が切り替わっている**部品の componentId。
   *
   * 遅延なしのリレーではコイルの励磁と一致するが、タイマーでは
   * ずれる（オンディレイは設定時間ぶん遅れて入る）。`buildNets()` が
   * 見るのはこちら —— 名前は履歴的に「励磁」だが、意味は接点の側にある。
   * タイマーのコイルの状態は `timers` を見ること（design.md §5.13）。
   */
  energizedRelays: ReadonlySet<string>;
  /** 点灯中のランプの componentId */
  litLamps: ReadonlySet<string>;
  /** `terminalKey(componentId, terminalId)` → ネット ID */
  netOf: ReadonlyMap<string, number>;
  /** ネット ID → 電位状態 */
  netState: ReadonlyMap<number, NetState>;
  warnings: Warning[];
  status: SimulationStatus;
  /** 収束までに要した反復回数 */
  iterations: number;
  /** タイマーのインスタンス ID → 実行時状態。次回の `previousTimers` になる */
  timers: ReadonlyMap<string, TimerState>;
  /**
   * 次にタイマーの接点が変わる時刻（ms）。カウント中のタイマーが 1 個も
   * 無ければ `undefined`。
   *
   * **ストアが「まだ時計を進める必要があるか」を判断する唯一の手がかり。**
   * これが無いと、タイマーを 1 個も置いていない回路でも延々と再計算を
   * 回し続けることになる。
   */
  nextEventAtMs?: number;
};
