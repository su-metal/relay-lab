/**
 * 端子の型定義（design.md §3.1）。
 *
 * 端子は本プロダクトの中核。抽象化された「入力 / 出力」ではなく、
 * 実機と同じ端子番号（MY4N の 13 / 14 など）をそのまま保持する。
 */

/**
 * 端子の電気的な役割。
 *
 * エンジンはこの役割を直接分岐条件には使わない（導通判定は
 * `ElectricalDefinition` 側の端子 ID 指定で行う）。役割は主に
 * UI の表示・ツールチップ・端子の色分けのためにある。
 */
export type TerminalRole =
  | "power_positive"
  | "power_zero"
  /**
   * 交流電源の非接地側（L / ライブ）と接地側（N / ニュートラル）。
   *
   * **`power_positive` / `power_zero` を流用しない。** 交流に + と 0V は無く、
   * 画面が「電源 +」と書いた時点で、直流と同じものだと読ませてしまう。
   * `ElectricalDefinition` 側は `positiveTerminal` / `zeroTerminal` という
   * フィールド名のままだが（型の形を電源の種類で分けない）、**画面に出る
   * 呼称はこの役割で分ける**（design.md §4.13）。
   *
   * L と N は電位差の両端であって、どちらが「高い」わけでもない。
   * エンジンは今までどおり「同じ 1 台の電源の両端に届くか」だけを見る。
   */
  | "power_line"
  | "power_neutral"
  | "coil_positive"
  | "coil_negative"
  /**
   * 極性を持たないコイルの端子。
   *
   * G7L のようにデータシートが「コイル極性はありません」と明記し、
   * 端子に `+` / `−` の印字が無い型番で使う。`coil_positive` を当てると
   * 実機に無い極性を画面が主張してしまう（design.md §4.8）。
   */
  | "coil"
  | "common"
  | "normally_open"
  | "normally_closed"
  | "anode"
  | "cathode"
  /**
   * 0–10V の調光信号線と、その基準（0V コモン）（design.md §5.17）。
   *
   * **`power_zero` を基準側に流用しない。** 調光のコモンは電源の 0V へ
   * 繋ぐのが普通だが、それは配線の話であって端子の役割ではない。
   * ここを `power_zero` と書くと、**繋いでいなくても電源の 0V が
   * そこにあるかのように**画面が主張してしまい、
   * 「GND を共通にしていない」という最も捕まえたい誤配線が読めなくなる。
   */
  | "analog_signal"
  | "analog_common"
  | "generic";

/** 端子が部品のどの辺に出るか。React Flow の Handle の向きに対応する */
export type TerminalSide = "top" | "right" | "bottom" | "left";

export type TerminalDefinition = {
  /** 部品定義内で一意な ID。原則として端子番号と同じ文字列 */
  id: string;
  /** 画面表示用のラベル（"14" "+24V" など） */
  label: string;
  /**
   * 実端子番号。実型番の部品にのみ存在する。
   * 汎用部品（電源・押しボタン・ランプ）は実端子番号を持たないため undefined。
   */
  number?: string;
  role: TerminalRole;
  /** 同一接点に属する COM / NO / NC を束ねる（"c1".."c4"） */
  contactGroup?: string;
  /** ツールチップ本文（"コイル + / DC24V" など） */
  description?: string;
  /** 部品内の相対座標。左上を (0, 0)、右下を (1, 1) とする */
  position: { x: number; y: number };
  side: TerminalSide;
};
