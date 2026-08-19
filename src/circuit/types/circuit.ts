/**
 * 回路ドキュメント（design.md §3.3）。
 *
 * これが保存対象（LocalStorage への永続化単位）。
 * シミュレーションの実行時状態はここに含めない — 混ぜると保存 JSON に
 * 実行時状態が混入し、Undo 履歴も汚れる（design.md §7）。
 */

import type { CircuitConnection } from "./connection";

/**
 * 表示ランプのレンズの色（design.md §4.11）。
 *
 * **実機の表示灯はレンズを選ぶもの**で、盤面では「赤＝異常・緑＝運転」のように
 * 色そのものが意味を持つ。図面で赤と緑を描き分けられないと、その意味が消える。
 *
 * **定義（型番）ではなくインスタンスに持つ。** レンズは同じ型番の表示灯に
 * 差し替えて使うもので、定義に固定すると色ごとに別の部品を並べることになる
 * （タイマーの `presetMs` と同じ考え方）。
 *
 * 並びは盤面で使う頻度の順。`DEFAULT_LAMP_COLOR` は**既存の回路の見た目を
 * 変えないため**に、この機能が入る前の色（琥珀）と同じ黄にしてある。
 */
export const LAMP_COLORS = ["yellow", "red", "green", "blue", "white"] as const;

export type LampColor = (typeof LAMP_COLORS)[number];

export const DEFAULT_LAMP_COLOR: LampColor = "yellow";

/** 未知の文字列を弾く。保存 JSON を読むときと、UI から受けるときの両方で使う */
export const isLampColor = (value: unknown): value is LampColor =>
  typeof value === "string" && (LAMP_COLORS as readonly string[]).includes(value);

export type CircuitComponentInstance = {
  /** インスタンス ID。回路内で一意 */
  id: string;
  /** 参照する `ComponentDefinition.id` */
  definitionId: string;
  /** "RY1" "S1" などのユーザー付与名 */
  label?: string;
  position: { x: number; y: number };
  /**
   * 左右反転して描くか（design.md §8.1）。省略は反転なし。
   *
   * **見た目だけの属性で、電気的な意味は一切持たない。** 反転しても端子 ID は
   * 変わらず、`CircuitConnection` も `ComponentDefinition.electrical` も
   * まったく同じものを指す。エンジンはこのフィールドを読まない。
   */
  flipped?: boolean;
  /**
   * タイマーの設定時間（ms）。省略時は定義の `defaultPresetMs`（design.md §5.13）。
   *
   * **定義ではなくインスタンスに持つ。** 実機のタイマーはダイヤルで
   * 設定するものであり、定義に固定すると「3 秒の T1 と 10 秒の T2」を
   * 同じ型番で置けなくなる。
   *
   * `delay` を持たない部品では意味を持たない（読み手も書き手もいない）。
   */
  presetMs?: number;
  /**
   * 表示ランプのレンズの色。省略は `DEFAULT_LAMP_COLOR`。
   *
   * **見た目だけの属性で、電気的な意味は一切持たない**（`flipped` と同じ）。
   * エンジンはこのフィールドを読まない —— 色で点灯条件が変わることは無い。
   *
   * ランプ以外の部品では意味を持たない。
   */
  lampColor?: LampColor;
};

export type CircuitDocument = {
  version: 1;
  components: CircuitComponentInstance[];
  connections: CircuitConnection[];
  viewport: { x: number; y: number; zoom: number };
};
