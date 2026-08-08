/**
 * 停止中の配線の役割配色（design.md §5.8）。
 *
 * §5.6 の `WireState` は**シミュレーション中**の色であり、停止中はすべて灰色に
 * なる。図面を描いている時間の大半は停止中なので、その間まったく色の手がかりが
 * 無い。ここでは実務の盤配線と同じ考え方 —— 常時 + 側の線は赤、0V の線は青、
 * 接点を介して電源につながる制御線は黄 —— で、**回路を動かさずに**線の役割を
 * 割り当てる。
 *
 * 判定は 2 回のネット構築だけで済む。
 *
 * 1. **静止状態**（ボタン非押下・全リレー非励磁）のネット
 *    → 電源に直結している線が分かる（赤 / 青）
 * 2. **全部品を動作させた状態**のネット
 *    → 接点を閉じれば電源に届く線が分かる（黄）
 *
 * 2 を取るのは、A 接点の先の線が静止状態ではどの電源にも到達せず、
 * 「配線し忘れた線」と区別できないため。どちらでも届かない線だけが灰になるので、
 * **灰は「まだ電源につながっていない」の意味を持つ**（配線漏れの手がかりになる）。
 *
 * このファイルは React を import しない純粋関数なので node 環境の Vitest で検証できる。
 */

import { buildNets, computeNetStates } from "@/circuit/engine";
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
 * `operated` は押下中のスイッチと励磁中のリレーの両方に渡す。`buildNets` は
 * 部品の `kind` に応じた方しか見ないので、**両方に全 ID を入れても安全**であり、
 * ここで部品種別を分岐せずに済む（CLAUDE.md 設計原則 2 の精神）。
 */
const netsWith = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
  operated: ReadonlySet<string>,
): Nets => {
  const nets = buildNets(
    document,
    definitions,
    { pressedSwitches: operated },
    operated,
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
  state !== undefined && (state.reachesPlus || state.reachesZero);

/**
 * 端子 1 個の役割を決める。
 *
 * 判定順は §5.6 と揃えて **`short` を最初**に置く。次に静止状態の電源直結
 * （赤 / 青）を見て、最後に動作させたときの到達性（黄）を見る。
 */
const roleAt = (rest: Nets, operated: Nets, key: string): WireRole => {
  const atRest = stateOf(rest, key);
  if (atRest?.reachesPlus && atRest.reachesZero) return "short";
  if (atRest?.reachesPlus) return "plus";
  if (atRest?.reachesZero) return "zero";
  // B 接点は動作させると開くので、静止状態でも動作状態でも届かないものだけが灰
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

  const everything = new Set(document.components.map((instance) => instance.id));
  const rest = netsWith(document, definitions, new Set());
  const operated = netsWith(document, definitions, everything);

  for (const connection of document.connections) {
    roles.set(
      connection.id,
      roleAt(rest, operated, terminalRefKey(connection.from)),
    );
  }
  return roles;
};
