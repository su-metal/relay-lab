/**
 * 停止中の配線の役割配色（design.md §5.8）。
 *
 * §5.6 の `WireState` は**シミュレーション中**の色であり、停止中はすべて灰色に
 * なる。図面を描いている時間の大半は停止中なので、その間まったく色の手がかりが
 * 無い。ここでは実務の盤配線と同じ考え方 —— 常時 + 側の線は赤、0V の線は青、
 * 接点を介して電源につながる制御線は黄 —— で、**回路を動かさずに**線の役割を
 * 割り当てる。
 *
 * 判定は 3 回のネット構築だけで済む。
 *
 * 1. **静止状態**（スイッチ非操作・全リレー非励磁）のネット
 *    → 電源に直結している線が分かる（赤 / 青）
 * 2. **スイッチだけ操作した状態**（全リレーは非励磁）のネット
 * 3. **リレーまで動作させた状態**のネット
 *    → 2・3 のどちらかで電源に届けば、接点を閉じれば使える線（黄）
 *
 * 2・3 を取るのは、A 接点の先の線が静止状態ではどの電源にも到達せず、
 * 「配線し忘れた線」と区別できないため。どれでも届かない線だけが灰になるので、
 * **灰は「まだ電源につながっていない」の意味を持つ**（配線漏れの手がかりになる）。
 *
 * **2 を独立させているのは b 接点の直列チェーンのため。** インターロックや
 * 先行優先の回路は「どのリレーも励磁していない間だけ導通する起動経路」を
 * b 接点で組む。3 だけを見ると、リレーが励磁して b 接点が開いた姿しか見えず、
 * **正しく描かれた起動経路がまるごと配線漏れに見える。** 静止状態と全動作状態の
 * 2 点では、その間にある「スイッチは入っているがリレーはまだ動いていない」
 * という起動の瞬間が抜け落ちる。
 *
 * このファイルは React を import しない純粋関数なので node 環境の Vitest で検証できる。
 */

import {
  buildNets,
  computeNetStates,
  isShorted,
  reachesPlus,
  reachesZero,
} from "@/circuit/engine";
import type {
  CircuitDocument,
  ComponentDefinitionRegistry,
  NetState,
} from "@/circuit/types";
import { terminalRefKey } from "@/circuit/types";

/**
 * 停止中の配線 1 本の役割。
 *
 * `short` を持つのは §5.6 と同じ理由。**最も危険な配線ミスを最も安全な見た目に
 * してはいけない。** 停止中でも +24V と 0V が直結していれば分かるようにする。
 */
export type WireRole =
  /** 常時 + 側（電源の + 端子と同一ネット） */
  | "plus"
  /** 常時 0V 側 */
  | "zero"
  /** 接点・スイッチを介して電源につながる制御線 */
  | "control"
  /** どう動作させても電源に届かない（配線漏れの可能性） */
  | "isolated"
  /** + と 0V が同一ネット＝電源短絡 */
  | "short";

/** ネット ID を引ける最小の組。`NetLookup` と同型だが読み取り専用で持つ */
type Nets = {
  netOf: ReadonlyMap<string, number>;
  netState: ReadonlyMap<number, NetState>;
};

/**
 * 指定した動作状態でネットと電位を求める。
 *
 * スイッチとリレーに**別々の集合**を渡す。`buildNets` は部品の `kind` に応じた
 * 方しか見ないので、どちらにも全 ID を入れて構わない（部品種別を分岐せずに
 * 済む・CLAUDE.md 設計原則 2 の精神）。分けているのは
 * 「スイッチは入っているがリレーはまだ動いていない」状態を作るためだけ。
 */
const netsWith = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
  pressedSwitches: ReadonlySet<string>,
  energizedRelays: ReadonlySet<string>,
): Nets => {
  const nets = buildNets(
    document,
    definitions,
    { pressedSwitches },
    energizedRelays,
  );
  return {
    netOf: nets.netOf,
    netState: computeNetStates(document, definitions, nets),
  };
};

const stateOf = (nets: Nets, key: string): NetState | undefined => {
  const netId = nets.netOf.get(key);
  return netId === undefined ? undefined : nets.netState.get(netId);
};

/** どちらかの電源に届いているか（黄＝制御線の判定に使う） */
const reachesPower = (state: NetState | undefined): boolean =>
  reachesPlus(state) || reachesZero(state);

/**
 * 端子 1 個の役割を決める。
 *
 * 判定順は §5.6 と揃えて **`short` を最初**に置く。次に静止状態の電源直結
 * （赤 / 青）を見て、最後に動作させたときの到達性（黄）を見る。
 *
 * 到達性は**どれか 1 つの状態で届けば十分**。灰（配線漏れ）は「直すべき線」の
 * 合図なので、迷ったら灰にしない側へ倒す —— 正しい線を疑わせる誤検出のほうが、
 * 見逃しよりも害が大きい。
 */
const roleAt = (
  rest: Nets,
  switched: Nets,
  operated: Nets,
  key: string,
): WireRole => {
  const atRest = stateOf(rest, key);
  if (isShorted(atRest)) return "short";
  if (reachesPlus(atRest)) return "plus";
  if (reachesZero(atRest)) return "zero";
  if (reachesPower(stateOf(switched, key))) return "control";
  if (reachesPower(stateOf(operated, key))) return "control";
  return "isolated";
};

/**
 * 配線ごとの役割を求める。キーは `CircuitConnection.id`。
 *
 * 配線の両端は必ず同一ネットなので、`from` 側だけを見れば足りる
 * （`simulation-view.ts` の `wireOf` と同じ理屈）。
 */
export const buildWireRoles = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
): ReadonlyMap<string, WireRole> => {
  const roles = new Map<string, WireRole>();
  if (document.connections.length === 0) return roles;

  const nothing: ReadonlySet<string> = new Set();
  const everything = new Set(document.components.map((instance) => instance.id));

  const rest = netsWith(document, definitions, nothing, nothing);
  // スイッチは入っているがリレーはまだ動いていない＝起動の瞬間
  const switched = netsWith(document, definitions, everything, nothing);
  const operated = netsWith(document, definitions, everything, everything);

  for (const connection of document.connections) {
    roles.set(
      connection.id,
      roleAt(rest, switched, operated, terminalRefKey(connection.from)),
    );
  }
  return roles;
};
