/**
 * リレーの内部挙動（design.md §5.1・§5.3）。
 *
 * ここには **型番分岐を書かない**（CLAUDE.md 設計原則 2）。
 * MY4N と MY4N-D2 の違いは `CoilPolarity` の 3 値だけで表現され、
 * 新型番が増えてもこのファイルは変わらない。
 */

import type {
  AnalogResult,
  AnalogTrigger,
  CircuitDocument,
  ComponentDefinitionRegistry,
  RelayContact, NetState, RelayDefinition } from "@/circuit/types";
import { analogInputKey, operationKey } from "@/circuit/types";

import { polarityAcross } from "./potential";

/** 同一部品内で導通する 2 端子（`TerminalDefinition.id` のペア） */
export type TerminalPair = readonly [string, string];

/**
 * 励磁状態に応じて閉じている接点の端子ペアを返す。
 *
 * c 接点（SPDT）は COM が必ずどちらか一方に繋がる。
 * 非励磁なら COM–NC、励磁なら COM–NO。
 *
 * a 接点のみ（SPST-NO）のリレーは **NC 端子が実機に存在しない**ので、
 * 非励磁では閉じるペアが 1 つも無い（COM はどこにも繋がらない）。
 * ここで見ているのは `ncTerminal` の有無だけで、接点の形の名前も型番も見ない
 * —— 相手の端子が定義に無ければ union する対象が無い、という 1 行で済む。
 *
 * `openContacts` は**切り替わる一瞬の中間位置**（NC も NO も開いている）を表す
 * 接点 ID の集合。実機の c 接点は break-before-make で、NC が開いてから NO が
 * 閉じるまでに必ず「どちらにも繋がっていない」瞬間がある。通常の解析では
 * 通らない状態だが、`chatter.ts` がこの瞬間を作ってコイルの給電が残るかを
 * 調べる（design.md §5.14）。省略時は従来どおり NC / NO のどちらかが閉じる。
 */
export const closedContactPairs = (
  relay: RelayDefinition,
  energized: boolean,
  openContacts?: ReadonlySet<string>,
  operatedContacts?: ReadonlySet<string>,
): TerminalPair[] =>
  relay.contacts.flatMap((contact) => {
    if (openContacts?.has(contact.id)) return [];
    const other = contactOperated(contact, energized, operatedContacts)
      ? contact.noTerminal
      : contact.ncTerminal;
    return other === undefined ? [] : [[contact.commonTerminal, other]];
  });

/**
 * この接点が動作しているか（design.md §4.16）。
 *
 * **接点はコイルだけで動くものではない。** アナログ量で動く接点
 * （カットリレー）と人の操作で動く接点（操作卓のボタン）は、コイルの
 * 励磁とは無関係に自分の駆動源を見る。駆動源を持たない接点だけが
 * 従来どおりコイルに従う。
 *
 * **判定はここ 1 箇所。** `closedContactPairs()` と `openContactPairs()` が
 * 同じ規則を 2 度書くと、片方だけ直す事故が起きる（§5.1 と同じ理由）。
 */
export const contactOperated = (
  contact: RelayContact,
  energized: boolean,
  operatedContacts?: ReadonlySet<string>,
): boolean =>
  contact.trigger !== undefined || contact.operationId !== undefined
    ? operatedContacts?.has(contact.id) === true
    : energized;

/**
 * 今は開いているが、**リレーの状態が反転すれば閉じる**端子ペアを返す。
 *
 * `closedContactPairs()` の裏返しで、非励磁なら COM–NO、励磁なら COM–NC。
 * 「電位がこの接点で止まっている」を言うために要る（design.md §5.15）。
 *
 * a 接点のみ（SPST-NO）のリレーが励磁している場合、開くペアは 1 つも無い ——
 * `ncTerminal` が実機に存在しないため（CLAUDE.md 設計原則 6）。
 * ここでも見ているのは端子の有無だけで、接点の形の名前も型番も見ない。
 *
 * 中間位置（`openContacts`）は受け取らない。**あれは接点が切り替わる一瞬の
 * 状態**であって（design.md §5.14）、「どちらへ倒れれば通るか」を問うここには
 * 答えが無い。
 */
export const openContactPairs = (
  relay: RelayDefinition,
  energized: boolean,
  operatedContacts?: ReadonlySet<string>,
): TerminalPair[] =>
  relay.contacts.flatMap((contact) => {
    const other = contactOperated(contact, energized, operatedContacts)
      ? contact.ncTerminal
      : contact.noTerminal;
    return other === undefined ? [] : [[contact.commonTerminal, other]];
  });

export type CoilEvaluation = {
  /** コイルが励磁するか */
  energized: boolean;
  /** 表示 LED が点灯するか（"indicator" のコイルは順接時のみ） */
  indicatorOn: boolean;
  /** 逆極性で電圧がかかっており、警告に値するか */
  reversed: boolean;
};

/**
 * コイルの励磁を判定する（design.md §5.3）。
 *
 * コイルの 2 端子はグラフ上で union されていないため、
 * 両端のネットの電位から向きを読み取るしかない。
 */
export const evaluateCoil = (
  coil: RelayDefinition["coil"],
  positiveState: NetState | undefined,
  negativeState: NetState | undefined,
): CoilEvaluation => {
  /*
   * **コイルが無い機器は、コイルでは動かない**（design.md §4.16）。
   *
   * カットリレー（アナログ量で動く）や操作卓のボタンには実機にコイルが
   * 無い。ここで「非励磁」を返すことで、極性の警告も未接続の指摘も
   * 出なくなる —— 存在しないものは検査しない。接点は
   * `closedContactPairs()` が `operated` 側から動かす。
   */
  if (!coil) return { energized: false, indicatorOn: false, reversed: false };

  const polarity = polarityAcross(positiveState, negativeState);
  const forward = polarity === "forward";
  const reverse = polarity === "reverse";

  switch (coil.polarity) {
    case "none":
      // MY2N / MY4N。表示灯が逆並列 LED なので逆接でも点灯する。
      // 逆接も正常な使い方なので警告しない
      return {
        energized: forward || reverse,
        indicatorOn: forward || reverse,
        reversed: false,
      };
    case "indicator":
      // 単方向 LED を持つコイル。逆接でも励磁するが表示 LED が点灯しない。
      // **現時点でこの値を持つ定義は無い**（MY シリーズは全て none か strict）。
      // 対応部品を足すときまで、ここを MY2N / MY4N の挙動と混同しないこと
      return { energized: forward || reverse, indicatorOn: forward, reversed: reverse };
    case "strict":
      // MY4N-D2。逆接では内蔵ダイオードが順方向になり励磁しない
      return { energized: forward, indicatorOn: forward, reversed: reverse };
  }
};

/**
 * 回路中の「動作している接点」を求める（design.md §4.16）。
 *
 * componentId → 動作している接点 ID の集合。駆動源を持たない接点
 * （コイルで動く普通の接点）はここに入らない —— あちらは
 * `energizedRelays` が受け持つ。
 *
 * **アナログの側は明るさ（%）で見る。** 実機の「0〜50% で動作」という
 * 表記がそのまま設定になる。V で持つと、極性を反転した盤で動作点が
 * 裏返って同じ「30% で動作」が別の意味になる。
 */
export const operatedContactsOf = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
  analog: AnalogResult,
  operatedDevices: ReadonlySet<string> | undefined,
): Map<string, Set<string>> => {
  const operated = new Map<string, Set<string>>();

  for (const instance of document.components) {
    const definition = definitions.get(instance.definitionId);
    if (!definition) continue;
    const { electrical } = definition;
    if (electrical.kind !== "relay") continue;

    for (const contact of electrical.relay.contacts) {
      let on = false;

      if (contact.trigger) {
        const level = analog.inputLevelOf.get(
          analogInputKey(instance.id, contact.trigger.inputId),
        );
        // 信号が解けていない（入力が定義に無い等）なら動作しない
        if (level) on = level.percent <= triggerPercentOf(contact.trigger, instance.triggerPercents?.[contact.id]);
      } else if (contact.operationId) {
        on =
          operatedDevices?.has(operationKey(instance.id, contact.operationId)) ===
          true;
      } else {
        // 駆動源を持たない接点はコイルの担当。ここでは触らない
        continue;
      }

      if (!on) continue;
      const set = operated.get(instance.id) ?? new Set<string>();
      set.add(contact.id);
      operated.set(instance.id, set);
    }
  }

  return operated;
};

/**
 * 動作点（%）。インスタンスの設定を先に見て、無ければ定義の既定値。
 * 範囲外は定義の上下限へ丸める（`presetMsOf` とまったく同じ形）。
 */
export const triggerPercentOf = (
  trigger: AnalogTrigger,
  percent: number | undefined,
): number => {
  const value =
    percent === undefined || !Number.isFinite(percent)
      ? trigger.defaultBelowPercent
      : percent;
  return Math.min(Math.max(value, trigger.minPercent), trigger.maxPercent);
};
