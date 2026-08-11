/**
 * 端子グラフとネット構築（design.md §5.1・§5.2）。
 *
 * すべての端子を無向グラフのノードとし、Union-Find で連結成分＝「ネット」を求める。
 * ネットの電位は「+ 側の電源端子に到達できるか / 0V 側に到達できるか」の 2 ビットだけ。
 */

import type {
  CircuitDocument,
  ComponentDefinitionRegistry,
  ElectricalDefinition,
  NetState,
  SimulationInput,
} from "@/circuit/types";
import { terminalKey, terminalRefKey } from "@/circuit/types";

import {
  collectDiodeEdges,
  spreadThroughDiodes,
  type MutableNetState,
} from "./diode";
import { closedContactPairs, type TerminalPair } from "./relay";

/**
 * 経路圧縮つき Union-Find。キーは `terminalKey()` の文字列。
 *
 * ランク統合はしていない。回路 1 枚の端子数は高々数百で、
 * 経路圧縮だけで実用上ほぼ定数時間になるため。
 */
class UnionFind {
  private readonly parent = new Map<string, string>();

  add(key: string): void {
    if (!this.parent.has(key)) this.parent.set(key, key);
  }

  find(key: string): string {
    this.add(key);
    let root = key;
    for (;;) {
      const next = this.parent.get(root);
      if (next === undefined || next === root) break;
      root = next;
    }
    // 経路圧縮
    let cursor = key;
    while (cursor !== root) {
      const next = this.parent.get(cursor) ?? root;
      this.parent.set(cursor, root);
      cursor = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent.set(rootA, rootB);
  }
}

export type NetAssignment = {
  /** `terminalKey(componentId, terminalId)` → ネット ID（0 始まりの連番） */
  netOf: Map<string, number>;
  /** ネットの総数 */
  netCount: number;
};

/** ネット ID からその電位状態を引ける最小の組。UI へ返す前の中間表現 */
export type NetLookup = {
  netOf: ReadonlyMap<string, number>;
  netState: ReadonlyMap<number, NetState>;
};

/**
 * 部品の内部で導通する端子ペアを返す。
 *
 * **負荷（コイル・ランプ・ダイオード）は絶対にここへ含めてはならない。**
 * 導線として union すると `+24V → コイル → 0V` を組んだ時点で
 * +24V 端子と 0V 端子が同一ネットになり、電源短絡を誤検出する（design.md §5.2）。
 * 負荷は「両端が異なる電源ネットに属するか」で判定する対象であって、導通経路ではない。
 *
 * **公開しているのは自己保持の経路探索（§5.9）のため。** ネット ID からは
 * 「どの端子どうしが直接つながっているか」が復元できず、adapter 側で同じ規則を
 * 書き直すと接点の開閉規則が 2 箇所に散る。判定はここ 1 箇所に閉じる。
 */
export const conductingPairs = (
  componentId: string,
  electrical: ElectricalDefinition,
  input: SimulationInput,
  energizedRelays: ReadonlySet<string>,
): TerminalPair[] => {
  switch (electrical.kind) {
    case "switch": {
      const operated = input.pressedSwitches.has(componentId);
      // A 接点は押している間だけ閉じ、B 接点は押している間だけ開く
      const closed =
        electrical.contactType === "NO" ? operated : !operated;
      return closed ? [[electrical.terminalA, electrical.terminalB]] : [];
    }
    case "relay":
      return closedContactPairs(
        electrical.relay,
        energizedRelays.has(componentId),
      );
    case "terminal":
      // 端子台は全端子が常時導通する。先頭端子に順に繋げば連結成分は 1 つになる
      return electrical.terminals
        .slice(1)
        .map((id) => [electrical.terminals[0], id] as TerminalPair);
    case "power":
    case "lamp":
    case "diode":
      // 電源の +/0V、ランプの 2 端子、ダイオードの 2 端子はいずれも非導通。
      // ダイオードは一方通行なので無向グラフでは表せない。導通は union ではなく
      // `computeNetStates()` の有向な電位伝搬で表現する（design.md §5.4）
      return [];
  }
};

/**
 * 現在の入力と励磁状態から端子グラフを構築し、ネット ID を割り当てる。
 *
 * 定義が見つからない部品は無視する（`validation.ts` は扱わない — 保存データの
 * 破損は読み込み時に弾く前提）。
 */
export const buildNets = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
  input: SimulationInput,
  energizedRelays: ReadonlySet<string>,
): NetAssignment => {
  const dsu = new UnionFind();
  const orderedKeys: string[] = [];
  const known = new Set<string>();

  const register = (key: string): string => {
    if (!known.has(key)) {
      known.add(key);
      orderedKeys.push(key);
      dsu.add(key);
    }
    return key;
  };

  // 1. すべての端子をノードとして登録する（未配線の端子もネットを持つ）
  for (const instance of document.components) {
    const definition = definitions.get(instance.definitionId);
    if (!definition) continue;
    for (const terminal of definition.terminals) {
      register(terminalKey(instance.id, terminal.id));
    }
  }

  // 2. 配線
  for (const connection of document.connections) {
    dsu.union(
      register(terminalRefKey(connection.from)),
      register(terminalRefKey(connection.to)),
    );
  }

  // 3. 部品内部の導通（閉じている接点・スイッチ・端子台のみ）
  for (const instance of document.components) {
    const definition = definitions.get(instance.definitionId);
    if (!definition) continue;
    for (const [a, b] of conductingPairs(
      instance.id,
      definition.electrical,
      input,
      energizedRelays,
    )) {
      dsu.union(
        register(terminalKey(instance.id, a)),
        register(terminalKey(instance.id, b)),
      );
    }
  }

  // 根 → 連番 ID。端子の登録順に振るので結果が回ごとにぶれない
  const netOf = new Map<string, number>();
  const idOfRoot = new Map<string, number>();
  for (const key of orderedKeys) {
    const root = dsu.find(key);
    let id = idOfRoot.get(root);
    if (id === undefined) {
      id = idOfRoot.size;
      idOfRoot.set(root, id);
    }
    netOf.set(key, id);
  }

  return { netOf, netCount: idOfRoot.size };
};

/**
 * 各ネットの電位状態を求める。
 *
 * 電源部品の + 端子が属するネットに**その電源のインスタンス ID**を
 * `plusFrom` として、0V 端子が属するネットに `zeroFrom` として記録し、
 * そのあとダイオードを通して**一方向にだけ**伝搬させる（design.md §5.4）。
 *
 * **どの電源のものかを残すのが要点。** 真偽値 2 個に潰すと、基準を共有して
 * いない 2 台の電源をまたいだ負荷が通電と出る（design.md §5.3）。
 *
 * **同じ 1 台**の + と 0V が同じネットに乗ったら電源短絡である
 * （validation.ts で検出する）。ダイオードを跨いで両方乗った場合も同じ意味 ——
 * 負荷を挟まずに + から 0V へ抜ける経路ができており、実機では焼損する。
 */
export const computeNetStates = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
  nets: NetAssignment,
): Map<number, NetState> => {
  /** 伝搬中は書き換えるので可変の Set で持ち、`NetState` として読み出す */
  const states = new Map<number, MutableNetState>();
  for (let id = 0; id < nets.netCount; id += 1) {
    states.set(id, { plusFrom: new Set(), zeroFrom: new Set() });
  }

  const mark = (
    componentId: string,
    terminalId: string,
    side: "plusFrom" | "zeroFrom",
  ): void => {
    const netId = nets.netOf.get(terminalKey(componentId, terminalId));
    if (netId === undefined) return;
    states.get(netId)?.[side].add(componentId);
  };

  for (const instance of document.components) {
    const definition = definitions.get(instance.definitionId);
    if (!definition) continue;
    const { electrical } = definition;
    if (electrical.kind !== "power") continue;
    mark(instance.id, electrical.positiveTerminal, "plusFrom");
    mark(instance.id, electrical.zeroTerminal, "zeroFrom");
  }

  spreadThroughDiodes(
    states,
    collectDiodeEdges(document, definitions, nets.netOf),
  );

  return states;
};

/** 端子が属するネットの電位状態を引く。未登録の端子は undefined（＝浮いている） */
export const stateAt = (
  lookup: NetLookup,
  componentId: string,
  terminalId: string,
): NetState | undefined => {
  const netId = lookup.netOf.get(terminalKey(componentId, terminalId));
  return netId === undefined ? undefined : lookup.netState.get(netId);
};
