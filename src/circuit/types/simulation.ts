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

/**
 * アナログ信号が乗っているネット 1 本（design.md §5.17）。
 *
 * **導通レイヤ（`NetState`）とは別に重ねる。** 電圧値を `NetState` に
 * 混ぜると、0V を出しているだけの調光信号線が電源の 0V と見分けが
 * つかなくなり、電源短絡の判定にも配線色にも紛れ込む。
 */
export type AnalogSignal = {
  /** 信号ネットの電圧（V） */
  volts: number;
  /** この電圧の基準となるネット ID（調光出力のコモン側） */
  referenceNet: number;
  /** この電圧を出している調光出力のインスタンス ID */
  sourceIds: readonly string[];
  /**
   * 外部から基準まで引き下げられている（実機盤の "DIRECT" 相当）。
   *
   * 接点で信号線を 0V コモンに落とすと信号ネットと基準ネットが
   * 同じネットになる。**別のグラフは要らない** —— 既存の Union-Find が
   * そのまま表している（requirements.md ⑥）。
   */
  pulledToReference: boolean;
};

/**
 * 調光入力を持つ負荷 1 個の解（design.md §5.17）。
 *
 * `volts` と `percent` の両方を持つのは、**端子には V を、部品には % を**
 * 出すため（requirements.md US-AK）。変換規則は定義側の
 * `AnalogCurve` にあり、ここには結果だけが入る。
 */
export type DimmingLevel = {
  /** 入力段が見ている電圧（V） */
  volts: number;
  /** 明るさ（0–100）。逆特性の機器では 0V が 100 になる */
  percent: number;
  /**
   * 信号が届いていないため、定義の `unconnectedVolts` を使った。
   *
   * **0V = 100% の仕様では、これが「挿し忘れて全灯」そのもの。**
   */
  floating: boolean;
  /**
   * 調光出力は繋がっているが、**基準（0V コモン）が共通でない。**
   *
   * 0–10V は基準に対する電圧なので、この状態では信号が成立しない
   * （design.md §5.3 の `supplyMismatch` とまったく同じ話）。
   * 成立しない以上、レベルは `floating` と同じ扱いになる。
   */
  referenceMismatch: boolean;
  /**
   * 強制的に出力を遮断されている（実機の「強制出力遮断」）。
   *
   * 位相制御調光器の遮断端子を基準へ落とすとこれが立ち、**信号が
   * 何 V だろうと 0%。** 消えている理由が「暗くしたから」なのか
   * 「遮断されているから」なのかは、盤を追うときにまったく別の話に
   * なるので、`percent: 0` に丸めずここに残す。
   */
  cutOff: boolean;
};

/** アナログ層の解（`SimulationResult.analog`・design.md §5.17） */
export type AnalogResult = {
  /** ネット ID → そのネットに乗っているアナログ信号 */
  signalOf: ReadonlyMap<number, AnalogSignal>;
  /**
   * 調光入力を持つ部品の componentId → 明るさ。
   *
   * 自分で調光信号を受ける負荷（`dimming` を持つランプ）と、
   * 通り道である位相制御調光器（`kind: "dimmer"`）の両方が入る。
   */
  levelOf: ReadonlyMap<string, DimmingLevel>;
  /**
   * 位相制御調光器の**出力回路**に載ったネット ID → 明るさ（design.md §5.17）。
   *
   * 調光器は自分が点る負荷ではなく、**通した先を暗くする通り道**。
   * だから明るさは部品ではなくネットに乗る —— その回路に繋いだランプが
   * 何個あっても、同じ 1 つの明るさで点る（実機どおり）。
   *
   * **自分の調光入力を持つランプはこれを見ない。** 直に受けている信号の
   * ほうが具体的で、両方あるときに調光器側を優先すると
   * 「繋いだ信号線が効かない」という読めない挙動になる。
   */
  netLevelOf: ReadonlyMap<number, DimmingLevel>;
};

/** アナログ信号が 1 本も無い回路の解。毎回空の Map を作らないための共有値 */
export const EMPTY_ANALOG_RESULT: AnalogResult = {
  signalOf: new Map(),
  levelOf: new Map(),
  netLevelOf: new Map(),
};

/** 警告の種別（design.md §5.7 の 7 種に対応） */
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
  | "not-converged"
  /**
   * 調光信号は繋がっているのに、基準（0V コモン）が共通でない。
   * 0–10V は基準に対する電圧なので信号が成立しない（design.md §5.17）
   */
  | "analog-reference-mismatch";

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
  /**
   * 点灯中のランプの componentId。
   *
   * **調光ランプは明るさ 0% を「消灯」として扱う**（design.md §5.17）。
   * 電源が来ていても 10V（この仕様では 0%）なら光っていないので、
   * ここには入らない。
   */
  litLamps: ReadonlySet<string>;
  /**
   * アナログ層の解（design.md §5.17）。
   * 調光を使っていない回路では空（`EMPTY_ANALOG_RESULT`）。
   */
  analog: AnalogResult;
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
