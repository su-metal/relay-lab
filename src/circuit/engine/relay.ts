/**
 * リレーの内部挙動（design.md §5.1・§5.3）。
 *
 * ここには **型番分岐を書かない**（CLAUDE.md 設計原則 2）。
 * MY4N と MY4N-D2 の違いは `CoilPolarity` の 3 値だけで表現され、
 * 新型番が増えてもこのファイルは変わらない。
 */

import type { NetState, RelayDefinition } from "@/circuit/types";

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
 */
export const closedContactPairs = (
  relay: RelayDefinition,
  energized: boolean,
): TerminalPair[] =>
  relay.contacts.flatMap((contact) => {
    const other = energized ? contact.noTerminal : contact.ncTerminal;
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
