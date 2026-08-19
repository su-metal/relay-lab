/**
 * 自分の接点で自分のコイルの給電を切っている配線の検出（design.md §5.14）。
 *
 * **これは収束計算では見つからない誤りである。** 収束ループ（§5.5）が探すのは
 * 「接点の状態とコイルの状態が矛盾しない組み合わせ」＝安定解であって、
 * 接点が切り替わる**途中**は状態として存在しない。ところが実機の c 接点は
 * break-before-make —— NC が開いてから NO が閉じるまでに必ず「どちらにも
 * 繋がっていない」瞬間がある。この瞬間にコイルの給電が消える配線は、
 * 吸引と復帰を繰り返して唸る（チャタリング）。
 *
 * 起動経路を自分の b 接点に通し、自己保持を自分の a 接点で取る配線がその典型で、
 * **安定解としては何の矛盾も無い**ため `simulate()` は `stable` を返す。
 * 実機だけが唸る。この差を埋めるのがこのファイルの役目（design.md §6-4）。
 *
 * 判定は 2 段階で、どちらも「実際にネットを組み直して聞く」。開閉の規則を
 * ここへ書き写さない —— 接点の規則は `closedContactPairs()` 1 箇所に閉じる。
 *
 * 1. **そのリレーだけ復帰位置に戻して**コイルに電圧がかかるか。
 *    かからないなら吸引しないので、唸りようが無い
 * 2. その状態から**接点を中間位置**（NC も NO も開）へ移し、まだコイルに
 *    電圧がかかるか。**残るなら唸らない** —— 外部のスイッチや他のリレーの
 *    接点で給電されており、自分の動作に給電を邪魔されていない
 *
 * 1 が成り立ち 2 が成り立たないとき、コイルは自分の接点で自分を切っている。
 *
 * このファイルは React / Zustand / React Flow を import しない（CLAUDE.md 設計原則 1）。
 */

import type {
  CircuitDocument,
  ComponentDefinitionRegistry,
  RelayDefinition,
  SimulationInput,
  Warning,
} from "@/circuit/types";
import { terminalKey, terminalRefKey } from "@/circuit/types";

import {
  buildNets,
  computeNetStates,
  stateAt,
  type NetLookup,
} from "./graph";
import { evaluateCoil } from "./relay";
import { describeComponent } from "./validation";

/** 復帰位置で閉じている（＝動作すると開く）接点。端子番号まで確定させた形 */
type BreakingContact = {
  id: string;
  common: string;
  nc: string;
};

/** 配線に 1 度でも現れる端子 */
const wiredTerminals = (document: CircuitDocument): ReadonlySet<string> => {
  const wired = new Set<string>();
  for (const connection of document.connections) {
    wired.add(terminalRefKey(connection.from));
    wired.add(terminalRefKey(connection.to));
  }
  return wired;
};

/**
 * 復帰位置で閉じており、かつ COM と NC の両方が配線されている接点。
 *
 * 片方でも浮いていれば給電経路になりえないので、ネットを組み直すまでもなく
 * 除ける。MY4N のように使わない接点を多く持つ部品で無駄な構築を減らす。
 */
const breakingContacts = (
  instanceId: string,
  relay: RelayDefinition,
  wired: ReadonlySet<string>,
): BreakingContact[] =>
  relay.contacts.flatMap((contact) => {
    const { ncTerminal } = contact;
    // a 接点のみのリレー（G7L）は復帰位置で閉じる接点を持たない
    if (ncTerminal === undefined) return [];
    if (!wired.has(terminalKey(instanceId, contact.commonTerminal))) return [];
    if (!wired.has(terminalKey(instanceId, ncTerminal))) return [];
    return [{ id: contact.id, common: contact.commonTerminal, nc: ncTerminal }];
  });

export const detectSelfInterruptingCoils = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
  input: SimulationInput,
  energizedRelays: ReadonlySet<string>,
): Warning[] => {
  const warnings: Warning[] = [];
  const wired = wiredTerminals(document);

  for (const instance of document.components) {
    const definition = definitions.get(instance.definitionId);
    if (!definition) continue;
    const { electrical } = definition;
    if (electrical.kind !== "relay") continue;

    /*
     * **タイマーは対象外。** 限時のぶん接点が遅れて動くので、自分の接点で
     * 自分を切る配線は「唸り」ではなく設定時間を周期とする点滅回路になる。
     * 実際にそう組むフリッカ回路があり、警告にすると正しい配線を否定する。
     * ここで見ているのは `delay` の有無だけで、`category` も型番も見ない
     * （CLAUDE.md 設計原則 2・7）。
     */
    if (electrical.delay) continue;

    const { relay } = electrical;
    const breaking = breakingContacts(instance.id, relay, wired);
    if (breaking.length === 0) continue;

    /*
     * **このリレーだけ**復帰位置に戻す。他のリレーは収束した状態のまま置く ——
     * 見たいのは「今この回路の状態で、このリレーが吸引しようとしたら何が
     * 起きるか」であって、回路全体を初期状態に戻した話ではない。
     */
    const released = new Set(energizedRelays);
    released.delete(instance.id);

    const coilLive = (open?: ReadonlySet<string>): boolean => {
      const nets = buildNets(
        document,
        definitions,
        input,
        released,
        open === undefined ? undefined : new Map([[instance.id, open]]),
      );
      const netState = computeNetStates(document, definitions, nets);
      const lookup: NetLookup = { netOf: nets.netOf, netState };
      const { coil } = relay;
      if (!coil) return false;
      return evaluateCoil(
        coil,
        stateAt(lookup, instance.id, coil.positiveTerminal),
        stateAt(lookup, instance.id, coil.negativeTerminal),
      ).energized;
    };

    // ① 復帰位置で電圧がかからない＝吸引しない
    if (!coilLive()) continue;
    // ② 中間位置でも電圧が残る＝自分の動作に給電を邪魔されていない
    if (coilLive(new Set(relay.contacts.map((contact) => contact.id)))) continue;

    /*
     * どの接点が効いているかを 1 つずつ開いて特定する。全部開くと切れるが
     * 単独では切れない（＝自分の接点を通る経路が複数ある）配線もありうるので、
     * 見つからなければ端子を挙げずに本文だけ出す。
     */
    const culprits = breaking.filter(
      (contact) => !coilLive(new Set([contact.id])),
    );

    const name = describeComponent(instance, definition);
    const labelOf = (terminalId: string): string =>
      definition.terminals.find((terminal) => terminal.id === terminalId)
        ?.label ?? terminalId;
    const where =
      culprits.length === 0
        ? `${name} 自身の b 接点`
        : culprits
            .map(
              (contact) =>
                `端子 ${labelOf(contact.common)}–${labelOf(contact.nc)}`,
            )
            .join("・");

    warnings.push({
      code: "coil-self-interrupt",
      severity: "warning",
      message: `${name} のコイルが ${where}（${name} 自身の b 接点）を通して給電されています。${name} が動作した瞬間にこの接点が開いてコイル自身の給電が切れるため、実機では吸引と復帰を繰り返して唸ります（チャタリング）。自己保持の a 接点が別にあっても、接点が切り替わる一瞬は b も a も開くので止まりません。起動経路からこの接点を外してください（逆流を止める目的で入れているなら、代わりにダイオードを使います）。`,
      componentId: instance.id,
      terminalId: culprits[0]?.nc ?? relay.coil?.positiveTerminal,
    });
  }

  return warnings;
};
