/**
 * 自己保持の検出（design.md §5.9）。
 *
 * §5.6 の配線色は「今この線に電源が届いているか」までしか言わない。だが
 * 自己保持回路を読むときに知りたいのは **「今このリレーを保持しているのは誰か」**
 * ―― 押しているボタンなのか、自分の接点なのか ―― であり、それは電位からは
 * 読み取れない。ボタンを押している間も離した後も、コイルの + 側は同じ緑になる。
 *
 * ここでは励磁中のリレー 1 個ずつに **「もしこのリレーが落ちたら、そのまま
 * 落ちたままか」** を問う。落ちたままなら、今その励磁を支えているのは自分自身の
 * 接点しかない ―― これが自己保持の定義そのものである。
 *
 * 問い方は `simulate()` の再実行 1 回。`previousEnergizedRelays` から対象の
 * リレーだけを抜いた状態で解き直せば、
 *
 * - 抜いたリレーが戻ってくる → ボタンなど**外部**が保持している（自己保持ではない）
 * - 抜けたまま落ちる → **自分の接点**が保持していた（自己保持）
 *
 * が分かる。収束ループをそのまま使うので、A が B を保持し B が A を保持する
 * ような連鎖も自然に扱える（1 個落とせば芋づるに落ちる）。
 *
 * **型番分岐は書かない**（CLAUDE.md 設計原則 2）。見るのは
 * `ComponentDefinition` のコイル端子だけで、接点が何組あるか・どの端子が
 * 自己保持に使われているかは問わない。
 *
 * このファイルは React を import しない純粋関数なので node 環境の Vitest で検証できる。
 */

import { simulate } from "@/circuit/engine";
import type {
  CircuitDocument,
  ComponentDefinitionRegistry,
  NetState,
  SimulationResult,
} from "@/circuit/types";
import { terminalKey } from "@/circuit/types";

export type SelfHoldView = {
  /** 自分の接点で自分のコイルを保持しているリレーの componentId */
  relays: ReadonlySet<string>;
  /**
   * 保持経路にある端子（`terminalKey()`）。
   *
   * **「そのリレーが落ちると電源を失う、コイル側の枝」だけ**が入る。
   * 電源から接点の COM までの幹線は落としても + のままなので入らない
   * （幹線まで塗ると「切れたら落ちる線」がぼやける）。
   */
  terminals: ReadonlySet<string>;
};

/** 自己保持が 1 つも無いときのビュー。停止中もこれを使う */
export const EMPTY_SELF_HOLD: SelfHoldView = {
  relays: new Set(),
  terminals: new Set(),
};

/** ネット ID を引ける最小の組（`SimulationResult` の一部をそのまま渡せる） */
type Nets = {
  netOf: ReadonlyMap<string, number>;
  netState: ReadonlyMap<number, NetState>;
};

/** その端子がどちらかの電源に届いているか */
const isPowered = (nets: Nets, key: string): boolean => {
  const netId = nets.netOf.get(key);
  if (netId === undefined) return false;
  const state = nets.netState.get(netId);
  return state !== undefined && (state.reachesPlus || state.reachesZero);
};

/**
 * 自己保持しているリレーと、その保持経路を求める。
 *
 * @param result 現在の（安定した）シミュレーション結果。停止中は `null`
 * @param pressedSwitches 現在操作中のスイッチ。**what-if でも同じものを渡す**
 *   —— ボタンを押したままなら「押している限り保持されている」が正しい答え
 */
export const buildSelfHold = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
  result: SimulationResult | null,
  pressedSwitches: ReadonlySet<string>,
): SelfHoldView => {
  if (!result || result.energizedRelays.size === 0) return EMPTY_SELF_HOLD;

  const relays = new Set<string>();
  const terminals = new Set<string>();

  for (const instance of document.components) {
    const definition = definitions.get(instance.definitionId);
    if (!definition) continue;
    const { electrical } = definition;
    if (electrical.kind !== "relay") continue;
    if (!result.energizedRelays.has(instance.id)) continue;

    // このリレーだけを落とした状態から解き直す。接点も一緒に開く
    const dropped = new Set(result.energizedRelays);
    dropped.delete(instance.id);
    const whatIf = simulate(document, definitions, {
      pressedSwitches,
      previousEnergizedRelays: dropped,
    });

    // 戻ってきた＝外部（ボタン・他のリレーの接点）が保持している。
    // 自分の接点を開いても消えないので、自己保持とは呼ばない
    if (whatIf.energizedRelays.has(instance.id)) continue;

    relays.add(instance.id);

    /*
     * 保持経路はコイルの 2 端子が属するネットの中にある。接点は union される
     * （§5.2）ので、電源 → 自己保持接点 → コイルの枝は **1 本のネット**に
     * なっており、コイル端子からそのまま辿れる。
     */
    const coilNets = new Set<number>();
    for (const terminalId of [
      electrical.relay.coil.positiveTerminal,
      electrical.relay.coil.negativeTerminal,
    ]) {
      const netId = result.netOf.get(terminalKey(instance.id, terminalId));
      if (netId !== undefined) coilNets.add(netId);
    }

    for (const [key, netId] of result.netOf) {
      if (!coilNets.has(netId)) continue;
      // 落としても電源に届いたままの端子（電源からの幹線・0V 側）は経路ではない。
      // 残るのは「この接点が開いたら死ぬ枝」だけになる
      if (isPowered(whatIf, key)) continue;
      terminals.add(key);
    }
  }

  return { relays, terminals };
};
