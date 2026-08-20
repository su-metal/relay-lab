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
  /**
   * アナログ量で動く接点（カットリレー・design.md §4.16）。
   *
   * **接点はコイルだけで動くものではない。** 明るさが動作点を下回ると
   * 動作する接点が実機にある。省略時はコイル（または `operationId`）で動く。
   */
  trigger?: AnalogTrigger;
  /**
   * 人の操作で動く接点（操作卓のボタン・design.md §4.16）。
   * `RelayDefinition.operations` の ID を指す。
   *
   * **1 台の機器の中で接点ごとに駆動源が違ってよい。** 操作卓は
   * ボタンごとに別の接点を動かす。
   */
  operationId?: string;
  commonTerminal: string;
  /** a 接点の端子。b 接点のみ（`SPST-NC`）のリレーには存在しない */
  noTerminal?: string;
  /** b 接点の端子。a 接点のみ（`SPST-NO`）のリレーには存在しない */
  ncTerminal?: string;
  type: "SPDT" | "SPST-NO" | "SPST-NC";
};

export type RelayDefinition = {
  /**
   * コイル。**省略可能。**
   *
   * カットリレー（アナログ量で動く）にも操作卓のボタン（人が倒す）にも
   * コイルは無い。実機に無いコイル端子を作って埋めるのは、`ncTerminal` を
   * 空文字で埋めるのと同じ誤り（CLAUDE.md 設計原則 6）。
   *
   * 省略すると、コイルの極性違反もコイルの未接続も出なくなる ——
   * 存在しないものは検査しない。
   */
  coil?: {
    voltage: number;
    currentType: "DC" | "AC";
    positiveTerminal: string;
    negativeTerminal: string;
    polarity: CoilPolarity;
  };
  /** 人が操作できる状態。`RelayContact.operationId` から参照する */
  operations?: readonly DeviceOperation[];
  /** 接点を動かすために受ける調光入力。`AnalogTrigger.inputId` から参照する */
  analogInputs?: readonly AnalogInputChannel[];
  /**
   * `analogInputs` を読む内部回路が要る外部電源。**省略可能。**
   *
   * カットリレーはコイルを持たないが、0–10V を読んでカットリレーを駆動する
   * 内部回路自体は実機で DC 電源が要る。ここが `polarityAcross()` で
   * 電位差なし（`"none"`）と判定される間、`analogInputs` は信号の有無に
   * かかわらず未接続時のレベルとして扱われる（design.md §5.17）。
   *
   * **`coil` とは別物。** 極性の向きや逆接の可否までは判定しない —— 実機の
   * 内部回路がどこまで保護されているかのデータが無いので、`polarity` は
   * 持たせず「電位差があるか」だけを見る（CLAUDE.md 設計原則 6 と同じ、
   * 無いものは検査しない考え方）。
   */
  power?: {
    positiveTerminal: string;
    negativeTerminal: string;
  };
  /**
   * `analogInputs` を「PWM に変換して」出す調光出力。**省略可能。**
   *
   * ライトコントローラのように、受けた 0–10V をそのまま接点で終わらせず
   * 別端子へ変換して出す実機がある。波形（PWM のデューティ比）そのものは
   * 扱わない（CLAUDE.md「実装できない制約」）ので、電圧としては
   * **入力側が読んだ最終的な明るさ（%）をそのまま表す**（design.md §5.17）。
   *
   * **`power` が必須。** ここは内部回路が変換して出す信号なので、`power`
   * が届いていない間は 1 本も出さない —— 未給電の LC を挟んだ先の
   * 調光ランプ・調光器は「LC が繋がっていない」のと同じ見え方になる。
   * `power` を持たない `analogOutputs` は無視される（出しようがない）。
   */
  analogOutputs?: readonly RelayAnalogOutputChannel[];
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
/**
 * 調光出力の 1 チャンネル（design.md §3.1・§4.15）。
 *
 * **1 回路だけの機器も 1 要素の配列で表す。** 実機の調光コントローラは
 * 0–10V を 16 回路持ち、回路ごとに別の電圧を出す。単数と複数で形を
 * 分けると、`analog.ts` の畳み込みも定義もインスタンスの設定も
 * 2 本になり、片方だけ直す事故が起きる（`RelayContact` を 1 接点でも
 * 配列で持っているのと同じ考え方）。
 */
export type AnalogOutputChannel = {
  /** 定義内で一意なチャンネル ID。原則として端子番号と同じ文字列 */
  id: string;
  /** 電圧を出す端子 */
  signalTerminal: string;
  /** 系統の呼び名（"フェーダー 1"）。表示だけに使い、エンジンは読まない */
  label?: string;
};

/**
 * フェード（時間をかけた明るさの変化）の設定範囲（design.md §5.18）。
 *
 * **`analog-source` に省略可能で足す。** タイマーを `kind: "timer"` にせず
 * `relay` の `delay` の有無で表したのと同じ形（CLAUDE.md 設計原則 7）。
 * フェードする調光出力も**ただの調光出力**であって別種の機器ではなく、
 * 電圧の畳み込みも基準の突き合わせも DIRECT もまったく同じコードが効く。
 * `fade` を持たない機器は今までどおり設定を変えた瞬間に目標値を出す。
 *
 * 形は `TimerDelay` の設定時間 3 点とそろえてある —— 実機のダイヤルに
 * あたるものを定義が上下限と既定値で、インスタンスが実際の値で持つ。
 */
export type FadeSpec = {
  /** 設定できる最短のフェード時間（ms）。0 は「フェードしない」 */
  minFadeMs: number;
  /** 設定できる最長のフェード時間（ms） */
  maxFadeMs: number;
  /**
   * 既定のフェード時間（ms）。
   *
   * **0 から始める。** 実機のフェード時間は盤ごとに設定するもので、
   * ここに 0 以外を焼き付けると**保存済みの回路を開いた瞬間に挙動が変わる。**
   * ユーザーがプロパティパネルで秒を入れて初めてフェードする。
   */
  defaultFadeMs: number;
};

/**
 * 実機の調光器で盤ごとに設定する量（design.md §4.15・§5.17）。
 *
 * **定義ではなくインスタンスに持つ。** これらは実機の DIP スイッチと
 * 可変抵抗にあたるもので、同じ型番の調光器を盤の中で別々に設定して使う。
 * 定義に固定すると「上限 100% の 1 台と 70% の 2 台」を同じ機器で
 * 置けなくなる（タイマーの `presetMs`・ランプの `lampColor` と同じ）。
 *
 * **とくに極性は定義に固定してはいけない。** 実機は 3 機種とも極性が
 * 切替式で、0V = 100% は「この盤の設定」であって機器の仕様ではない。
 * ここを定義側の `AnalogCurve` に焼き付けると、順特性で使っている
 * 同じ機器を置けなくなる。
 */
/**
 * アナログ量で接点を動かす条件（design.md §4.16）。
 *
 * **見るのは % であって V ではない。** 実機の「0〜50% で動作」という
 * 表記がそのまま設定になる。V で持つと、極性を反転した盤で動作点が
 * 裏返り、同じ「30% で動作」が別の意味になってしまう。
 */
export type AnalogTrigger = {
  /** どの調光入力を見るか（`RelayDefinition.analogInputs` の ID） */
  inputId: string;
  /**
   * この明るさ（%）**以下**で動作する。実機の CUT ADJ. にあたる既定値で、
   * インスタンスの `triggerPercents` で回路ごとに上書きできる。
   */
  defaultBelowPercent: number;
  /** 設定できる下限・上限（実機のつまみの目盛りに相当） */
  minPercent: number;
  maxPercent: number;
};

/**
 * 機器が持つ、人が操作できる状態（design.md §4.16）。
 *
 * **保存しない。** オルタネートスイッチと同じで、盤の状態は配線ではない
 * （design.md §4.7）。■ で停止すると OFF 位置へ戻る。
 */
export type DeviceOperation = {
  /** 定義内で一意な ID */
  id: string;
  /** 画面に出す名前（"電源"・"フェーダー 1"） */
  label: string;
  /**
   * 操作子の性質（design.md §4.17）。省略は `"switch"`。
   *
   * - `"switch"` … 入り切り。接点を動かす（既存の操作卓の電源ボタン）
   * - `"level"` … 0–100% の連続量。**フェーダー。** 接点ではなく
   *   通信で送る値になる
   *
   * **入り切りと連続量を別の型に分けない。** どちらも「人が倒す盤の状態」
   * であり、保存しない・停止で戻るという扱いも同じ。分けると
   * `SimulationInput` も store も UI も 2 本になる。
   */
  kind?: "switch" | "level";
  /** `"level"` のときの既定値（%）。省略は 0 */
  defaultPercent?: number;
};

/**
 * 通信ポート（design.md §4.17）。
 *
 * **電気モデルには参加しない。** 通信線が運ぶのは電位ではなく値で、
 * ネットの分割にも `NetState` にも関係が無い。だから
 * `ElectricalDefinition` の中ではなく、`ComponentDefinition` に
 * `electrical` と並ぶ別の面として持たせる。
 */
export type CommunicationPort = {
  /** ＋側（A）の端子 */
  plusTerminal: string;
  /** −側（B）の端子 */
  minusTerminal: string;
  /**
   * 信号の基準（GND）となる端子。
   *
   * **差動信号は基準を共有していないと成立しない。** 0–10V の調光信号と
   * まったく同じ話で（design.md §5.17）、繋ぎ忘れは実務で最も多い誤配線の
   * 1 つ。エンジンはここが共通かどうかを見て、共通でなければ通信を
   * 成立させない。
   */
  commonTerminals: readonly string[];
};

/**
 * 受け取った値を自分の出力へ割り当てる指定（design.md §4.17）。
 *
 * **名前で対応させる。** 送り手と受け手は `signalId`（"fader1"）という
 * 共有した名前だけで繋がり、エンジンはどちらの機器かを見ない
 * （CLAUDE.md 設計原則 2）。
 */
export type CommunicationBinding = {
  /** 受け取る値の名前。送り手の `DeviceOperation.id` と一致させる */
  signalId: string;
  /** 割り当て先の調光出力チャンネル（`analog-source` の `channels` の id） */
  channelId: string;
};

/** 機器の通信の面（design.md §4.17） */
export type CommunicationDefinition = {
  port: CommunicationPort;
  /**
   * この機器が送る操作子の ID（`RelayDefinition.operations` の id）。
   * 操作卓が持つ。
   */
  transmits?: readonly string[];
  /** 受け取った値を出力へ割り当てる指定。コントローラが持つ */
  receives?: readonly CommunicationBinding[];
};

/**
 * 機器が受ける調光入力の 1 回路（design.md §4.16）。
 *
 * `DimmingInput` と同じ形だが、**こちらは自分が点るためではなく
 * 接点を動かすために受ける。** ライトコントローラの INPUT がこれ。
 */
export type AnalogInputChannel = {
  /** 定義内で一意な ID。原則として端子番号と同じ文字列 */
  id: string;
  /** 調光信号（0–10V）を受ける端子 */
  signalTerminal: string;
  /** 信号の基準（0V コモン）となる端子 */
  commonTerminal: string;
  /** V → % の対応 */
  curve: AnalogCurve;
  /** 信号線が未接続のときに入力段が示すレベル（V） */
  unconnectedVolts: number;
};

/**
 * `RelayDefinition.analogInputs` を変換して出す調光出力の 1 回路
 * （design.md §5.17）。
 *
 * `AnalogOutputChannel`（`analog-source` が持つ、インスタンスの設定を
 * そのまま出す出力）とは別物 —— こちらは値を持たず、`fromInputId` が指す
 * `analogInputs` の**結果**をそのまま変換して出す。
 */
export type RelayAnalogOutputChannel = {
  /** 定義内で一意な ID。原則として端子番号と同じ文字列 */
  id: string;
  /** どの `RelayDefinition.analogInputs` の結果を変換して出すか */
  fromInputId: string;
  /** 変換した電圧を出す端子 */
  signalTerminal: string;
  /** 系統の呼び名。表示だけに使い、エンジンは読まない */
  label?: string;
};

export type DimmerSettings = {
  /**
   * 極性を反転する（実機の DIP）。
   *
   * 立てると `AnalogCurve` の両端が入れ替わり、0V = 100% ⇄ 10V = 100% が
   * 切り替わる。**エンジンは向きを知らない** —— 入れ替えるだけ。
   */
  inverted?: boolean;
  /** 調光上限（%）。実機の DIP で 100 / 90 / 80 / 70 */
  maxPercent?: number;
  /** 調光下限（%）。実機の可変抵抗で 0〜50 */
  minPercent?: number;
  /**
   * 調光カーブの形。
   *
   * - `linear` … 入力に比例
   * - `square` … 2 乗特性。低いほうが緩やかに効く（実機の「２乗特性」）
   */
  curveShape?: "linear" | "square";
  /**
   * DIRECT（直点）。**信号によらず全点灯。**
   *
   * 実機ではスイッチで切り替える。信号線を 0V へ落とす配線とは別物で、
   * こちらは機器の中で信号を無視する。
   */
  direct?: boolean;
};

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
 * エンジンが持ってよい分岐は、この `kind` が表す汎用の電気的な振る舞いだけ。
 * 端子は必ず ID 参照で指定し、端子番号や型番そのものをエンジンに埋め込まない。
 *
 * **タイマーで 1 通り増やさない。** タイマーリレーはリレーであり、
 * `relay` の `delay` の有無で表す（`TimerDelay` 参照）。
 * **調光ランプでも増やさない** —— 調光ランプはランプであり、
 * `lamp` の `dimming` の有無で表す（`DimmingInput` 参照）。
 *
 * `analog-source` は基準に対する電圧値を出す振る舞い、
 * `ac-dc-power-supply` は入力側の成立を条件に絶縁された出力電位を生成する振る舞いで、
 * いずれも既存 kind へ無理に寄せず、型番非依存の振る舞いとして定義する。
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
   * AC 入力を受けて DC を出すスイッチング電源。
   *
   * `power` はそれ自体が理想電源だが、こちらは入力側に適合する AC 電源が
   * 来ているときだけ出力を持つ。入力と出力は絶縁され、内部で union しない。
   * 型番分岐はせず、入出力範囲と端子 ID を定義データで持つ。
   */
  | {
      kind: "ac-dc-power-supply";
      ratedInputVoltageMin: number;
      ratedInputVoltageMax: number;
      allowableInputVoltageMin: number;
      allowableInputVoltageMax: number;
      lineTerminal: string;
      neutralTerminal: string;
      outputVoltage: number;
      positiveTerminal: string;
      zeroTerminal: string;
      ratedOutputCurrent?: number;
      ratedPower?: number;
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
      /** 出力チャンネル。1 回路だけの機器も 1 要素の配列で表す */
      channels: readonly AnalogOutputChannel[];
      /**
       * 出力の基準（0V コモン）となる端子。
       *
       * **複数あるのは機器内部で繋がっているから。** 実機の調光
       * コントローラは GND を 4 本（21・44・45・46）出しており、
       * どれに繋いでも同じ基準になる。**この端子どうしだけは union する**
       * —— 信号端子とコモンを union しない原則（CLAUDE.md 設計原則 3）は
       * 保ったまま、実機どおり GND 間を導通させる（design.md §5.1）。
       */
      commonTerminals: readonly string[];
      /** 出力できる下限・上限（実機のつまみの目盛りに相当） */
      minVolts: number;
      maxVolts: number;
      /** 既定の出力電圧。インスタンスの `channelVolts` で回路ごとに上書きできる */
      defaultVolts: number;
      /**
       * 通信で受けた **% を V へ直す規則**（design.md §4.17）。
       *
       * 通信は「フェーダーが 70%」という値を運ぶだけで、それが何 V に
       * なるかは**出す側の機器の設定**。実機も調整ボリュームで
       * 「消灯時 10V・点灯時 0V」に合わせる。
       *
       * 省略すると通信を受けても電圧に直せないので、`receives` を持つ
       * 機器は必ず持つ。インスタンスの `dimmerSettings.inverted` で
       * 反転でき、そこは他の機器とまったく同じ扱い。
       */
      outputCurve?: AnalogCurve;
      /**
       * フェード（design.md §5.18）。**持たない機器は即座に目標値を出す。**
       *
       * フェードするのは**出力する電圧そのもの**で、受け側の入力段は
       * 何も知らない —— 実機でも時間をかけているのはコントローラであり、
       * 調光器は来ている 0–10V に追従しているだけ。だから接点で 0V へ
       * 落とす配線（DIRECT）は**瞬時のまま**になる（機器の外の短絡で、
       * 出力段を通らない）。
       */
      fade?: FadeSpec;
    }
  /**
   * 位相制御調光器（design.md §4.15・§5.17）。
   *
   * **AC を通しながら、通した先の明るさを決める機器。** 入力の AC を
   * そのまま出力へ渡し（`inTerminal` ⇄ `outTerminal` は常時導通）、
   * その出力回路に載っている負荷の明るさを調光信号で決める。
   *
   * **`lamp` の `dimming` と同じ形にはできない。** あちらは自分が点る
   * 負荷で、こちらは**他人を暗くする通り道**。負荷ではないので
   * `litLamps` にも入らず、両端の電位差も見ない。
   *
   * 遮断（`cutoffTerminal` を基準へ落とす）と DIRECT は、
   * **導通ではなくレベルで表す。** 出力段を開くモデルにすると
   * 収束ループ（§5.5）にアナログが入り込み、「アナログ量は接点を
   * 動かさない」という第 2 パスの前提が崩れる（§5.17）。
   */
  | {
      kind: "dimmer";
      /** AC 入力 */
      inTerminal: string;
      /** AC 出力（調光された側） */
      outTerminal: string;
      /** AC のコモン */
      acCommonTerminal: string;
      /** 調光信号（0–10V）を受ける端子 */
      signalTerminal: string;
      /** 調光信号の基準（0V コモン）となる端子 */
      signalCommonTerminal: string;
      /**
       * 基準へ落とすと出力が遮断される端子（実機の「強制出力遮断」）。
       *
       * 接点で GND へ落とす配線がそのまま効く —— 既存の Union-Find が
       * 「同じネットか」で答えを出すので、専用の仕組みは要らない。
       */
      cutoffTerminal: string;
      /** V → % の対応。極性の反転はインスタンスの `dimmerSettings` が行う */
      curve: AnalogCurve;
      /** 調光信号が未接続のときに入力段が示すレベル（V） */
      unconnectedVolts: number;
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
   * 通信の面（design.md §4.17）。持たない機器では `undefined`。
   *
   * **`electrical` と並べる。** 通信は電位を運ばないので電気モデルの
   * 一部ではなく、ネットの分割にも配線色にも影響しない。
   */
  communication?: CommunicationDefinition;
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
