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
  | "terminal"
  /**
   * タイマーリレー。**電気的には `kind: "relay"` のまま**で、
   * `delay` の有無だけが違う（design.md §5.13）。カテゴリを分けているのは
   * パレットの見出しと図記号の出し分けという表示都合だけ。
   */
  | "timer"
  /**
   * 0–10V の調光出力（design.md §5.17）。
   *
   * **こちらはカテゴリだけでなく `ElectricalDefinition` も別**（`analog-source`）。
   * タイマーと違い、既存のどの `kind` の「省略可能なフィールドの有無」でも
   * 表せない —— 電位を配るのでも負荷になるのでもなく、**基準に対する
   * 電圧値を出す**という別の振る舞いだから。
   */
  | "dimmer";

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

/**
 * 接点 1 回路ぶん。
 *
 * `type` は接点の形であって型番ではない。エンジンが見るのは
 * **その向きの端子があるかどうか**の 1 点だけで、型番も `type` の文字列も
 * 参照しない（CLAUDE.md 設計原則 2・design.md §5.1）。
 *
 * - `SPDT`（c 接点）… COM が NC / NO のどちらかへ必ず倒れる。MY シリーズ
 * - `SPST-NO`（a 接点）… NC 端子が**実機に存在しない**。励磁している間だけ
 *   COM–NO が閉じ、非励磁では COM がどこにも繋がらない。G7L のような
 *   ねじ／タブ端子のパワーリレーがこれにあたる
 * - `SPST-NC`（b 接点）… その裏返しで **NO 端子が実機に存在しない**。
 *   非励磁のあいだ COM–NC が閉じ、励磁すると COM がどこにも繋がらない。
 *   電磁接触器の補助 b 接点（21–22）がこれにあたる（design.md §4.12）
 *
 * **`ncTerminal` / `noTerminal` を「無いから空文字」で埋めない。** 存在しない
 * 端子を空の端子番号として持つと、端子一覧にも接点表にも幽霊の行が出る。
 *
 * **2 つの省略可能な端子は対称に扱うこと。** 一方だけを `undefined` 前提で
 * 書くと、b 接点のみの接点が「NO 端子が undefined の a 接点」として
 * 静かにすり抜ける。エンジンの `closedContactPairs()` /
 * `openContactPairs()` は両側を同じ 1 行で弾いている（design.md §5.1）。
 */
export type RelayContact = {
  /** リレー定義内で一意な接点 ID。`TerminalDefinition.contactGroup` と対応する */
  id: string;
  commonTerminal: string;
  /** a 接点の端子。b 接点のみ（`SPST-NC`）のリレーには存在しない */
  noTerminal?: string;
  /** b 接点の端子。a 接点のみ（`SPST-NO`）のリレーには存在しない */
  ncTerminal?: string;
  type: "SPDT" | "SPST-NO" | "SPST-NC";
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
 * 限時（タイマー）の設定（design.md §5.13）。
 *
 * **タイマーリレーは「遅れて動くリレー」であって別種の部品ではない。**
 * コイルも接点も普通のリレーと同じものを持ち、違うのは接点が動く
 * タイミングだけ。だから `ElectricalDefinition` に `kind: "timer"` を
 * 新設せず、`kind: "relay"` にこのフィールドを**省略可能で**足す。
 * `RelayContact.ncTerminal` を省略可能にして a 接点のみのリレーを
 * 表したのと同じ拡張の形（design.md §4.8・CLAUDE.md 設計原則 6）。
 *
 * この形にしたおかげで、極性判定・接点の開閉・未接続端子の検出・
 * 自己保持の検出・経路説明・接点の図記号は**リレー用のコードがそのまま効く。**
 */
export type TimerDelay = {
  /**
   * 限時の向き。
   *
   * - `on-delay`（限時動作）… 入力が入って**設定時間後に**接点が動く。
   *   入力が切れたら即座に戻る
   * - `off-delay`（限時復帰）… 入力と**同時に**接点が動き、入力が切れてから
   *   設定時間そのまま保ってから戻る
   */
  mode: "on-delay" | "off-delay";
  /** 設定時間の既定値（ms）。インスタンスの `presetMs` で上書きできる */
  defaultPresetMs: number;
  /** 設定できる下限・上限（実機のダイヤルの目盛りに相当） */
  minPresetMs: number;
  maxPresetMs: number;
};

/**
 * 電圧（V）と明るさ（%）の対応（design.md §5.17）。
 *
 * **エンジンに型番分岐を書かないための宣言**（CLAUDE.md 設計原則 2）。
 * ユーザーの会社の調光仕様は `0V = 100% / 10V = 0%` という逆特性で、
 * 一般的な 0–10V 機器（0V = 消灯）と真逆になる。この違いを
 * `if (model === "FMD-701D") invert` で書いた瞬間に設計が壊れるので、
 * **端子が持つのは電圧だけ**にして、% への変換は定義側のこの宣言に閉じる。
 *
 * 順特性の機器を後から足しても `percentAtMin` / `percentAtMax` を
 * 入れ替えるだけで済み、エンジンは 1 行も変わらない。
 */
export type AnalogCurve = {
  /** 変換の下端の電圧（V） */
  minVolts: number;
  /** 変換の上端の電圧（V） */
  maxVolts: number;
  /** `minVolts` のときの明るさ（0–100）。逆特性ではここが 100 */
  percentAtMin: number;
  /** `maxVolts` のときの明るさ（0–100）。逆特性ではここが 0 */
  percentAtMax: number;
};

/**
 * 調光入力を持つ負荷の設定（design.md §5.17）。
 *
 * **`kind: "lamp"` に省略可能で足す。** タイマーを `kind: "timer"` に
 * せず `relay` の `delay` で表したのと同じ形（CLAUDE.md 設計原則 7）。
 * 調光ランプは「明るさが変わるランプ」であって別種の負荷ではなく、
 * 点灯条件（両端が同じ 1 台の電源の + と 0V に届くか）も普通のランプと同じ。
 * `kind` を分けると点灯判定・経路説明・図記号・ラダー図の分岐が
 * すべて 2 本になり、片方だけ直す事故が起きる。
 */
export type DimmingInput = {
  /** 調光信号（0–10V）を受ける端子 */
  signalTerminal: string;
  /**
   * 信号の基準（0V コモン）となる端子。
   *
   * **0–10V は基準に対する電圧なので、これが調光出力側のコモンと
   * 同じネットに無いと信号が成立しない**（design.md §5.3 の
   * 「同じ 1 台の電源か」とまったく同じ話）。
   */
  commonTerminal: string;
  /** V → % の対応 */
  curve: AnalogCurve;
  /**
   * 信号線が未接続のときに入力段が示すレベル（V）。
   *
   * **エンジンが決め打ちしない。** プルアップかプルダウンかは実機の
   * 入力回路次第で、0V = 100% の仕様と組み合わさると
   * **「挿し忘れると全灯する」**という気付きにくい失敗になる
   * （requirements.md US-AL）。だから定義に持たせ、
   * `unconnected-terminal` の警告文にそのまま出す。
   */
  unconnectedVolts: number;
};

/**
 * カテゴリごとの電気的なふるまい。`kind` による判別可能ユニオン。
 *
 * エンジンが持ってよい分岐はこの `kind` の 7 通りだけ。
 * 端子は必ず ID 参照で指定し、端子番号そのものをエンジンに埋め込まない。
 *
 * **タイマーで 1 通り増やさない。** タイマーリレーはリレーであり、
 * `relay` の `delay` の有無で表す（`TimerDelay` 参照）。
 * **調光ランプでも増やさない** —— 調光ランプはランプであり、
 * `lamp` の `dimming` の有無で表す（`DimmingInput` 参照）。
 *
 * 7 通目の `analog-source` だけは既存のどれにも寄せられない。
 * 電位を配る `power` でも、電位差を受ける `lamp` でもなく、
 * **基準に対する電圧値を出す**という別の振る舞いだから
 * （design.md §5.17）。
 */
export type ElectricalDefinition =
  | {
      kind: "power";
      voltage: number;
      currentType: "DC" | "AC";
      positiveTerminal: string;
      zeroTerminal: string;
    }
  /**
   * リレー。`delay` を持つものがタイマーリレー（design.md §5.13）。
   *
   * **`kind` を分けない。** 分けると接点・コイル・端子まわりの分岐が
   * エンジンと adapter の各所で 2 本になり、片方だけ直す事故が起きる。
   */
  | { kind: "relay"; relay: RelayDefinition; delay?: TimerDelay }
  | {
      kind: "switch";
      contactType: "NO" | "NC";
      action: "momentary" | "maintained";
      terminalA: string;
      terminalB: string;
    }
  /**
   * ランプ。`dimming` を持つものが調光ランプ（design.md §5.17）。
   *
   * **`kind` を分けない。** 点灯条件は調光の有無に関わらず
   * 「両端が同じ 1 台の電源の + と 0V に届くか」のままで、
   * `dimming` はその上に載る明るさの話にすぎない。
   */
  | {
      kind: "lamp";
      voltage: number;
      currentType: "DC" | "AC";
      terminalA: string;
      terminalB: string;
      dimming?: DimmingInput;
    }
  | { kind: "diode"; anodeTerminal: string; cathodeTerminal: string }
  /** 端子台。列挙した全端子が常時導通する */
  | { kind: "terminal"; terminals: string[] }
  /**
   * アナログ量（0–10V の調光信号）を出す部品（design.md §5.17）。
   *
   * **電源（`kind: "power"`）ではない。** 電源として扱うと
   * `plusFrom` / `zeroFrom` に乗って導通判定と配線色に混ざり、
   * 0V を出しているだけの信号線が「電源短絡」や「非通電」に化ける。
   * アナログ量は導通レイヤに重ねる第 2 パスとして解く。
   */
  | {
      kind: "analog-source";
      /** 電圧を出す端子 */
      signalTerminal: string;
      /** 出力の基準（0V コモン）となる端子 */
      commonTerminal: string;
      /** 出力できる下限・上限（実機のつまみの目盛りに相当） */
      minVolts: number;
      maxVolts: number;
      /** 既定の出力電圧。インスタンスの `outputVolts` で上書きできる */
      defaultVolts: number;
    };

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
