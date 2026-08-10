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
