/**
 * 部品定義の型（design.md §3.1 / §3.2）。
 *
 * ここが本プロダクトのデータ駆動設計の要。
 * **エンジンは型番（model）を見てはならない。** 動作はすべて
 * `ElectricalDefinition` の判別可能ユニオンから読み取る。
 * 新型番の追加が定義ファイル 1 枚で完結することを、この型で保証する。
 */

import type { TerminalDefinition } from "./terminal";

export type ComponentCategory =
  | "power"
  | "relay"
  | "switch"
  | "lamp"
  | "diode"
  | "terminal";

/**
 * コイルの極性の扱い（design.md §5.3）。
 *
 * 実機の挙動は「励磁する / しない」の 2 値ではないため 3 値にしている。
 * MY4N-D2（内蔵ダイオード）と MY4N（表示 LED のみ）の差はこの値だけで表現し、
 * エンジンに型番分岐を持ち込まない。
 */
export type CoilPolarity =
  /** 極性なし。どちら向きでも励磁する */
  | "none"
  /** 逆接でも励磁するが、表示 LED が点灯しない */
  | "indicator"
  /** 正しい極性でのみ励磁。逆接は内蔵ダイオードが順方向になり故障扱い */
  | "strict";

export type RelayContact = {
  /** リレー定義内で一意な接点 ID。`TerminalDefinition.contactGroup` と対応する */
  id: string;
  commonTerminal: string;
  noTerminal: string;
  ncTerminal: string;
  type: "SPDT";
};

export type RelayDefinition = {
  coil: {
    voltage: number;
    currentType: "DC" | "AC";
    positiveTerminal: string;
    negativeTerminal: string;
    polarity: CoilPolarity;
  };
  contacts: RelayContact[];
};

/**
 * カテゴリごとの電気的なふるまい。`kind` による判別可能ユニオン。
 *
 * エンジンが持ってよい分岐はこの `kind` の 6 通りだけ。
 * 端子は必ず ID 参照で指定し、端子番号そのものをエンジンに埋め込まない。
 */
export type ElectricalDefinition =
  | {
      kind: "power";
      voltage: number;
      currentType: "DC" | "AC";
      positiveTerminal: string;
      zeroTerminal: string;
    }
  | { kind: "relay"; relay: RelayDefinition }
  | {
      kind: "switch";
      contactType: "NO" | "NC";
      action: "momentary" | "maintained";
      terminalA: string;
      terminalB: string;
    }
  | {
      kind: "lamp";
      voltage: number;
      currentType: "DC" | "AC";
      terminalA: string;
      terminalB: string;
    }
  | { kind: "diode"; anodeTerminal: string; cathodeTerminal: string }
  /** 端子台。列挙した全端子が常時導通する */
  | { kind: "terminal"; terminals: string[] };

export type ComponentDefinition = {
  /** 定義 ID（"omron-my4n-dc24"）。`CircuitDocument` からはこの ID で参照する */
  id: string;
  manufacturer?: string;
  /** 型番（"MY4N"）。表示と検索のためにあり、エンジンは参照しない */
  model: string;
  category: ComponentCategory;
  terminals: TerminalDefinition[];
  electrical: ElectricalDefinition;
  visual: { width: number; height: number };
  /**
   * 端子データの出典。実型番はデータシート等の URL、
   * 汎用部品は実端子番号ではない旨を記す。
   */
  source?: string;
  /**
   * 実機／公式データシートで端子データを検証済みか。
   * 未検証の型番を検証済みとして扱わないこと（CLAUDE.md 設計原則 5）。
   */
  verified: boolean;
};

/**
 * 定義 ID → 定義 のレジストリ。`simulate(doc, defs, input)` の `defs`（design.md §5.5）。
 *
 * エンジンは定義の一覧を知らず、`CircuitDocument` に現れた ID を引くだけ。
 */
export type ComponentDefinitionRegistry = ReadonlyMap<
  string,
  ComponentDefinition
>;
