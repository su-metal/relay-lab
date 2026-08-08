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
};

/**
 * ネット（連結成分）の電位状態。
 *
 * 電圧値は持たない。「+ 側の電源端子に到達できるか / 0V 側に到達できるか」
 * の 2 ビットだけで導通と配線色を決める（design.md §5.6・§6-3）。
 */
export type NetState = {
  reachesPlus: boolean;
  reachesZero: boolean;
};

/** 警告の種別（design.md §5.7 の 5 種に対応） */
export type WarningCode =
  /** +24V 端子と 0V 端子が同一ネットになっている */
  | "power-short-circuit"
  /** コイルに逆極性で電圧がかかっている */
  | "coil-polarity-reversed"
  /** どの接続にも現れない端子がある */
  | "unconnected-terminal"
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
  /** 励磁中のリレーの componentId */
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
};
