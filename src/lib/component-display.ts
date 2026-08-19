import type {
  DeviceSimulationState,
  WireState,
} from "@/circuit/adapter/simulation-view";
import type { DiodeBias } from "@/circuit/engine";
import type {
  CoilPolarity,
  ComponentCategory,
  ComponentDefinition,
  RelayContact,
  TerminalRole,
} from "@/circuit/types";

/** カテゴリの日本語表示。パレットの見出しとプロパティパネルで共用する */
export const CATEGORY_LABELS: Record<ComponentCategory, string> = {
  power: "電源",
  switch: "スイッチ",
  relay: "リレー",
  lamp: "ランプ",
  diode: "ダイオード",
  terminal: "端子台",
  timer: "タイマー",
  dimmer: "調光",
};

/** パレットに並べる順序。`componentDefinitions` の並びより優先する */
export const CATEGORY_ORDER: readonly ComponentCategory[] = [
  "power",
  "switch",
  "relay",
  // リレーの直後。タイマーは「遅れて動くリレー」なので隣に並べる（design.md §5.13）
  "timer",
  // 調光出力はランプの直前。0–10V の行き先はランプなので隣に並べる
  "dimmer",
  "lamp",
  "diode",
  "terminal",
];

/**
 * 実端子番号を持つ部品か（`TerminalDefinition.number` の有無）。
 *
 * 「未検証」バッジの出し分けに使う。汎用部品（電源 / 押しボタン / ランプ）は
 * 実端子番号を持たないので `verified: false` ではあっても
 * **検証対象そのものが存在しない**（design.md §4.4 / §4.5）。
 * そこへ「未検証」と出すと、実型番の未検証バッジの意味が薄れる。
 */
export const hasRealTerminalNumbers = (
  definition: ComponentDefinition,
): boolean =>
  definition.terminals.some((terminal) => terminal.number !== undefined);

/**
 * 接点構成の呼び名（"4c" / "2a" / "4a1b"）。
 *
 * 現場の呼び方は接点の**数**だけでは決まらない。c 接点（切替・SPDT）の
 * MY4N は 4c、a 接点のみ（SPST-NO）の G7L 2 極は 2a と呼ぶ。
 * ここを一律 "c" と出すと、b 接点が無いリレーに b 接点があるように読める。
 *
 * **形の混在をひとまとめに丸めない。** 電磁接触器は主接点 3 極と補助
 * a 接点が SPST-NO、補助 b 接点が SPST-NC という混成で、これを "5c" と
 * 出すと**実機に無い切替接点を 5 回路ぶん主張する**ことになる。
 * 形ごとに数えて連ねる（"4a1b"）。
 *
 * 分岐しているのは接点の**形**であって型番ではない（CLAUDE.md 設計原則 2）。
 */
export const contactSummaryOf = (relay: {
  contacts: readonly RelayContact[];
}): string => {
  const countOf = (type: RelayContact["type"]) =>
    relay.contacts.filter((contact) => contact.type === type).length;

  // 並びは c → a → b。現場の呼び方（"1a1b"）に合わせる
  return (
    [
      [countOf("SPDT"), "c"],
      [countOf("SPST-NO"), "a"],
      [countOf("SPST-NC"), "b"],
    ] as const
  )
    .filter(([count]) => count > 0)
    .map(([count, suffix]) => `${count}${suffix}`)
    .join("");
};

/** 端子の役割の日本語表示。プロパティパネルの端子一覧で使う */
export const TERMINAL_ROLE_LABELS: Record<TerminalRole, string> = {
  power_positive: "電源 +",
  power_zero: "電源 0V",
  power_line: "電源 L（非接地側）",
  power_neutral: "電源 N（接地側）",
  coil_positive: "コイル +",
  coil_negative: "コイル −",
  coil: "コイル",
  common: "COM",
  normally_open: "NO（a接点）",
  normally_closed: "NC（b接点）",
  anode: "アノード",
  cathode: "カソード",
  analog_signal: "調光信号（0–10V）",
  analog_common: "調光の基準（0V コモン）",
  generic: "端子",
};

/**
 * コイルの極性の表示（design.md §5.3）。
 *
 * 「極性あり / なし」の 2 値に丸めない。MY4N（逆接でも励磁する）と
 * MY4N-D2（逆接では励磁しない）の差はまさにここにあり、
 * それを読み取れることがプロダクトの価値そのものだから。
 */
export const COIL_POLARITY_LABELS: Record<CoilPolarity, string> = {
  none: "極性なし",
  indicator: "極性あり（表示灯）",
  strict: "極性厳守",
};

/** 極性の意味の補足。パネルで 1 行添える */
export const COIL_POLARITY_NOTES: Record<CoilPolarity, string> = {
  none: "どちら向きに繋いでも励磁します。",
  indicator: "逆接でも励磁しますが、表示灯が点灯しません。",
  strict: "逆接では励磁しません（内蔵ダイオードが順方向）。",
};

/** ダイオードのバイアスの日本語表示（design.md §5.4） */
export const DIODE_BIAS_LABELS: Record<DiodeBias, string> = {
  forward: "順方向（導通）",
  reverse: "逆方向（遮断）",
  none: "電位差なし",
};

/**
 * コイルと並列でないダイオードに添える説明。
 *
 * リレーコイルは誘導負荷で、消磁の瞬間に逆起電力（サージ）を出す。
 * これを吸収するのが**コイルと並列**に、カソードをコイルの + 側へ向けて
 * 入れる還流ダイオード。この 1 行があるかどうかで、
 * ダイオードを直列に入れてしまう誤りを減らせる。
 */
export const DIODE_HINT =
  "順方向（A → K）にだけ電流を通します。逆起電力を吸収させるにはコイルと並列に、カソードをコイルの + 側へ向けて入れます。";

/** 端子・配線の電位状態の日本語表示（design.md §5.6） */
export const WIRE_STATE_LABELS: Record<WireState, string> = {
  inactive: "非通電",
  plus: "+ 側",
  zero: "0V 側",
  energized: "通電中",
  "self-hold": "自己保持",
  short: "短絡",
  analog: "調光信号",
};

/**
 * ノード内表示用に詰めた型番表示。
 *
 * 汎用部品の型番は補足の丸カッコ（"押しボタン A接点（モーメンタリ）" の
 * "（モーメンタリ）" 等）を含むと、部品ノードの幅に収まらず末尾が見切れる。
 * カッコの中身は `modelSummaryOf()` のホバーツールチップで読めるので、
 * ノード内表示（`DeviceNode.module.css` の `.model`）ではここで削る。
 */
export const shortModelLabel = (model: string): string =>
  model.replace(/（[^（）]*）$/u, "");

/** ホバーで出す型番詳細（`modelSummaryOf` の戻り値） */
export type ModelSummary = {
  /** 短縮していない正式な表示名（メーカー + 型番） */
  title: string;
  /** タイトルに続けて出す補足行 */
  lines: string[];
};

/**
 * 部品の見出し（`.heading`）にホバーした際の詳細表示。
 *
 * ノード内では `shortModelLabel()` で削った情報（正式な型番・端子数・
 * 検証状態）をここにまとめる。ノードの表示を削った分、ホバー側の
 * 情報量を増やして埋め合わせる（見切れ対策）。
 */
export const modelSummaryOf = (
  definition: ComponentDefinition,
): ModelSummary => {
  const title = definition.manufacturer
    ? `${definition.manufacturer} ${definition.model}`
    : definition.model;

  const verificationLine = hasRealTerminalNumbers(definition)
    ? definition.verified
      ? "検証済み（実端子番号）"
      : "未検証（実端子番号）"
    : "実端子番号なし";

  return {
    title,
    lines: [
      `${CATEGORY_LABELS[definition.category]} ・ ${definition.terminals.length} 端子`,
      verificationLine,
    ],
  };
};

/** ホバーで出す部品ステータスの表示内容（`deviceStatusOf` の戻り値） */
export type DeviceStatus = {
  label: string;
  /** 励磁・点灯・押下など「オン」寄りの状態か。ツールチップの強調表示に使う */
  active: boolean;
  /** 自己保持中か（design.md §5.9）。強調の色を緑から紫へ振り分けるのに使う */
  selfHeld?: boolean;
};

/**
 * 部品にホバーした際の主要ステータス表示（design.md §8.3）。
 *
 * `electrical.kind` ごとに「一目で確認したい状態」が違う
 * （リレーは励磁、ランプは点灯、押しボタンは押下）ので、ここで 1 つに絞る。
 * 電源・ダイオード・端子台は動的な状態を持たないので `undefined` を返し、
 * ノード側はツールチップ自体を出さない。
 * シミュレーション停止中（`simulation` が `undefined`）も同様。
 */
export const deviceStatusOf = (
  definition: ComponentDefinition,
  simulation: DeviceSimulationState | undefined,
): DeviceStatus | undefined => {
  if (!simulation) return undefined;
  switch (definition.electrical.kind) {
    case "relay":
      // 「励磁中」だけでは何が保持しているか読めない。自分の接点で保持している間は
      // そう名乗らせる（design.md §5.9）。ボタンを離した瞬間にここが切り替わる
      if (simulation.selfHeld) {
        return { label: "自己保持中", active: true, selfHeld: true };
      }
      return simulation.energized
        ? { label: "励磁中", active: true }
        : { label: "非励磁", active: false };
    case "lamp": {
      /*
       * 調光ランプ（design.md §5.17）。**明るさを添えないと「消灯」の理由が
       * 読めない。** 電源が来ていないのか、来ていて 0%（この仕様では 10V）
       * なのかは、実機を触るときにまったく違う話になる。
       */
      const percent = simulation.dimming
        ? `${Math.round(simulation.dimming.percent)}%`
        : undefined;
      if (simulation.lit) {
        return {
          label: percent ? `点灯中 ${percent}` : "点灯中",
          active: true,
        };
      }
      return {
        label: percent ? `消灯（${percent}）` : "消灯",
        active: false,
      };
    }
    case "analog-source": {
      // 出力は常に出ている。0V も「何も出していない」ではなく 0V という値
      const readings = simulation.channelVolts ?? [];
      if (readings.length === 0) return { label: "出力中", active: true };
      // 多回路の機器を 1 個の数字で代表させない。全回路が同じときだけまとめる
      const first = readings[0].volts;
      const uniform = readings.every((reading) => reading.volts === first);
      return {
        label: uniform
          ? `${first.toFixed(1)}V 出力中`
          : `${readings.length} 回路 出力中`,
        active: true,
      };
    }
    case "dimmer": {
      const level = simulation.dimming;
      if (!level) return { label: "調光中", active: true };
      // 消えている理由を言い分ける（遮断か、暗くしているだけか）
      if (level.cutOff) return { label: "出力遮断", active: false };
      return {
        label: `${Math.round(level.percent)}%`,
        active: level.percent > 0,
      };
    }
    case "switch": {
      // オルタネートは「押下」ではなく位置なので言い方を変える。
      // 同じ「押下中」と出すと、手を離しても状態が残ることが読めない
      const maintained = definition.electrical.action === "maintained";
      if (!simulation.pressed) {
        return maintained
          ? { label: "OFF 位置", active: false }
          : { label: "未押下", active: false };
      }
      /*
       * 操作しているのに回路から切り離されている（design.md §5.12）。
       * **`active: false` にする。** ホバーの強調（緑）は「今効いている」の
       * 意味なので、効いていない接点に付けると嘘になる
       */
      if (simulation.cutOff) {
        return {
          label: maintained ? "ON 位置（回路から切離）" : "押下中（回路から切離）",
          active: false,
        };
      }
      return maintained
        ? { label: "ON 位置", active: true }
        : { label: "押下中", active: true };
    }
    default:
      return undefined;
  }
};
