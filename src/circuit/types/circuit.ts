/**
 * 回路ドキュメント（design.md §3.3）。
 *
 * これが保存対象（LocalStorage への永続化単位）。
 * シミュレーションの実行時状態はここに含めない — 混ぜると保存 JSON に
 * 実行時状態が混入し、Undo 履歴も汚れる（design.md §7）。
 */

import type { ComponentDefinition, DimmerSettings } from "./component";
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

/** 部品 1 個の表示寸法。キャンバス座標系の px */
export type ComponentSize = { width: number; height: number };

export type CircuitComponentInstance = {
  /** インスタンス ID。回路内で一意 */
  id: string;
  /** 参照する `ComponentDefinition.id` */
  definitionId: string;
  /** "RY1" "S1" などのユーザー付与名 */
  label?: string;
  position: { x: number; y: number };
  /**
   * ユーザーが変更した表示寸法。省略時は `definition.visual` の既定寸法。
   *
   * **見た目だけの属性で、電気的な意味は一切持たない。** 端子座標は定義側で
   * 0〜1 の相対値として持つため、箱を広げても端子 ID や接続は変わらない。
   * 定義の既定寸法を安全な最小値とし、それより小さい値は保存・表示しない。
   */
  size?: ComponentSize;
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
  /**
   * 調光出力の電圧（V）を**チャンネル ID ごとに**持つ（design.md §5.17）。
   * 省略したチャンネルは定義の `defaultVolts`。
   *
   * **定義ではなくインスタンスに持つ**理由はタイマーの `presetMs` と同じ ——
   * 実機の調光出力はつまみや設定で決めるものであり、定義に固定すると
   * 「10V の DIM1 と 4V の DIM2」を同じ型番で置けなくなる。
   *
   * **1 回路の機器も Map で持つ。** 実機の調光コントローラは 16 回路を
   * 別々の電圧で出すので、単数と複数で持ち方を分けると読む側が 2 本になる
   * （`ElectricalDefinition` の `channels` が 1 要素でも配列なのと同じ）。
   *
   * `flipped` や `lampColor` と違い、**これは電気的な意味を持つ。**
   * エンジンはこの値を読み、繋がったランプの明るさが変わる。
   *
   * `kind: "analog-source"` 以外の部品では意味を持たない。
   */
  channelVolts?: Readonly<Record<string, number>>;
  /**
   * 調光出力のフェード時間（ms）。省略時は定義の `defaultFadeMs`（design.md §5.18）。
   *
   * **チャンネルごとに分けない。** 実機のフェードはシーン全体にかかる設定で、
   * 回路ごとの値ではない（`channelVolts` が回路ごとなのと対照的）。
   *
   * **定義ではなくインスタンスに持つ**理由は `presetMs` と同じ —— 実機の
   * フェード時間は盤ごとに設定するもので、定義に固定すると
   * 「3 秒の DIMC1 と 0 秒の DIMC2」を同じ機器で置けなくなる。
   *
   * `flipped` や `lampColor` と違い、**これは電気的な意味を持つ。**
   *
   * `fade` を持たない `analog-source` と、それ以外の部品では意味を持たない。
   */
  fadeMs?: number;
  /**
   * 調光器の盤ごとの設定（極性・上下限・カーブ・DIRECT）。
   * 省略時は定義の `curve` をそのまま使う（design.md §4.15）。
   *
   * **実機の DIP スイッチと可変抵抗にあたる。** 同じ機器を盤の中で
   * 別々に設定して使うものなので、定義ではなくインスタンスが持つ。
   * とくに極性は 3 機種とも切替式で、0V = 100% は「この盤の設定」で
   * あって機器の仕様ではない。
   *
   * **これも電気的な意味を持つ。** 調光入力を持つ部品
   * （`kind: "dimmer"` と `dimming` を持つランプ）で効く。
   */
  dimmerSettings?: DimmerSettings;
  /**
   * アナログ量で動く接点の動作点（%）を**接点 ID ごとに**（design.md §4.16）。
   * 省略時は定義の `defaultBelowPercent`。
   *
   * 実機の CUT ADJ.（回路ごとのつまみ）にあたる。**定義に固定しない** ——
   * 4 回路それぞれ別の動作点に設定して使うものなので、固定すると
   * 実機の使い方が再現できない（`presetMs` と同じ考え方）。
   */
  triggerPercents?: Readonly<Record<string, number>>;
};

/**
 * 保存値を定義の安全な最小寸法へ丸める。既定寸法そのものなら省略形へ戻す。
 *
 * 既定寸法を最小にするのは、各部品の端子ラベル・図記号・見出しがその寸法で
 * 読めることを定義作成時に確認済みだから。汎用の固定 px を別に置くと、型番を
 * 追加するたびに「定義では読めるのにリサイズでは潰れる」別基準が生まれる。
 */
export const normalizeComponentSize = (
  definition: Pick<ComponentDefinition, "visual">,
  size: ComponentSize,
): ComponentSize | undefined => {
  const width = Math.max(definition.visual.width, size.width);
  const height = Math.max(definition.visual.height, size.height);
  return width === definition.visual.width && height === definition.visual.height
    ? undefined
    : { width, height };
};

/** インスタンスに実際に使う寸法。壊れた旧データが来ても既定寸法より小さくしない */
export const componentSizeOf = (
  instance: Pick<CircuitComponentInstance, "size">,
  definition: Pick<ComponentDefinition, "visual">,
): ComponentSize => {
  const normalized = instance.size
    ? normalizeComponentSize(definition, instance.size)
    : undefined;
  return normalized ?? {
    width: definition.visual.width,
    height: definition.visual.height,
  };
};

export type CircuitDocument = {
  version: 1;
  components: CircuitComponentInstance[];
  connections: CircuitConnection[];
  viewport: { x: number; y: number; zoom: number };
};
