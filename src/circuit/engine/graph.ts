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
  collectDimmerEdges,
  spreadThroughDiodes,
  type MutableNetState,
} from "./diode";
import {
  closedContactPairs,
  openContactPairs,
  type TerminalPair,
} from "./relay";

/**
 * 経路圧縮つき Union-Find。キーは `terminalKey()` の文字列。
 *
 * ランク統合はしていない。回路 1 枚の端子数は高々数百で、
 * 経路圧縮だけで実用上ほぼ定数時間になるため。
 *
 * **公開しているのはラダー図の変換（§5.16）のため。** あちらは
 * 「電線と端子台だけを束ね、接点は開閉に関わらず枝のまま残す」という
 * こことは別の束ね方をするので `buildNets()` は使えないが、
 * 束ねる道具まで書き直す理由は無い。
 */
export class UnionFind {
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

/**
 * componentId → 動作している接点 ID の集合（design.md §4.16）。
 *
 * コイル以外の駆動源（アナログ量・人の操作）で動く接点だけが入る。
 * コイルで動く接点は `energizedRelays` が受け持つ。
 */
export type OperatedContacts = ReadonlyMap<string, ReadonlySet<string>>;

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
 * 接点を**中間位置**（NC も NO も開）に固定する指定。componentId → 接点 ID の集合。
 *
 * 実機の c 接点は break-before-make なので、切り替わる途中に必ず
 * 「どちらにも繋がっていない」瞬間がある。`chatter.ts` だけがこれを使い、
 * その瞬間にコイルの給電が残るかを調べる（design.md §5.14）。
 * 通常の収束ループは渡さない —— 中間位置は安定状態ではないので、
 * 解として求めるものではない。
 */
export type OpenContacts = ReadonlyMap<string, ReadonlySet<string>>;

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
/**
 * 列挙した端子を 1 本の鎖で繋ぐペア。端子台と、調光出力のコモン群で使う。
 *
 * 総当たり（n²）ではなく隣どうしだけを返す。Union-Find は推移的なので
 * 鎖で繋げば全体が 1 つのネットになり、端子が増えても線形で済む。
 */
const chainPairs = (terminals: readonly string[]): TerminalPair[] => {
  const pairs: TerminalPair[] = [];
  for (let i = 1; i < terminals.length; i += 1) {
    pairs.push([terminals[i - 1], terminals[i]]);
  }
  return pairs;
};

export const conductingPairs = (
  componentId: string,
  electrical: ElectricalDefinition,
  input: SimulationInput,
  energizedRelays: ReadonlySet<string>,
  openContacts?: OpenContacts,
  operatedContacts?: OperatedContacts,
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
        openContacts?.get(componentId),
        operatedContacts?.get(componentId),
      );
    case "terminal":
      // 端子台は全端子が常時導通する。先頭端子に順に繋げば連結成分は 1 つになる
      return electrical.terminals
        .slice(1)
        .map((id) => [electrical.terminals[0], id] as TerminalPair);
    case "power":
    case "ac-dc-power-supply":
    case "lamp":
    case "diode":
      // 電源の +/0V、ランプの 2 端子、ダイオードの 2 端子はいずれも非導通。
      // ダイオードは一方通行なので無向グラフでは表せない。導通は union ではなく
      // `computeNetStates()` の有向な電位伝搬で表現する（design.md §5.4）
      return [];
    case "analog-source":
      // **信号端子とコモンは union しない。** union すると、接点で 0V へ落とす
      // 配線（"DIRECT"）と繋がない配線が区別できなくなる。出している電圧は
      // `analog.ts` が第 2 パスで重ねる（design.md §5.17）。
      //
      // **コモンの端子どうしだけは union する。** 実機の調光コントローラは
      // GND を 4 本（21・44・45・46）出しており、機器の中で繋がっている。
      // ここを繋がないと、GND 21 に繋いだ機器と GND 45 に繋いだ機器が
      // 「基準が共通でない」と出て、正しい配線が成立しなくなる（§4.15）
      return chainPairs(electrical.commonTerminals);
    case "dimmer":
      // **AC は通すが union はしない。** 入力と出力を同じネットにすると、
      // 同じ電源から取った 2 台の調光器の出力回路まで 1 つに融合し、
      // 片方を絞るともう片方まで暗くなる。ダイオードと同じく
      // 「ネットは分けたまま電位だけ流す」形にしてあり、辺は
      // `collectDimmerEdges()` が出す（design.md §4.15・§5.4）。
      //
      // **遮断と DIRECT を導通で表さない。** 出力段を開くモデルにすると
      // アナログ量が接点（ネットの形）を動かすことになり、収束ループの
      // 中へ入り込む。第 2 パスの前提が崩れるので、どちらもレベルで表す
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
  openContacts?: OpenContacts,
  operatedContacts?: OperatedContacts,
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
      openContacts,
      operatedContacts,
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

  const directionalEdges = [
    ...collectDiodeEdges(document, definitions, nets.netOf),
    // 調光器の AC の通り道。ネットは分けたまま電位だけ流す（design.md §4.15）
    ...collectDimmerEdges(document, definitions, nets.netOf),
  ];

  // まず一次側の電位を有向要素の先まで届ける。
  spreadThroughDiodes(states, directionalEdges);

  const instanceById = new Map(document.components.map((instance) => [instance.id, instance]));
  const stateOfTerminal = (componentId: string, terminalId: string): MutableNetState | undefined => {
    const netId = nets.netOf.get(terminalKey(componentId, terminalId));
    return netId === undefined ? undefined : states.get(netId);
  };
  const isAcSource = (sourceId: string): boolean => {
    const source = instanceById.get(sourceId);
    if (!source) return false;
    const sourceElectrical = definitions.get(source.definitionId)?.electrical;
    return sourceElectrical?.kind === "power" && sourceElectrical.currentType === "AC";
  };

  // AC-DC 電源は、L/N が同じ AC 電源の両極へ届いたときだけ DC 出力を持つ。
  // 入力電圧範囲は仕様情報として保持するが、既存要件どおり電圧不一致判定には使わない。
  for (const instance of document.components) {
    const electrical = definitions.get(instance.definitionId)?.electrical;
    if (electrical?.kind !== "ac-dc-power-supply") continue;

    const line = stateOfTerminal(instance.id, electrical.lineTerminal);
    const neutral = stateOfTerminal(instance.id, electrical.neutralTerminal);
    if (!line || !neutral) continue;

    const powered = [...line.plusFrom].some(
      (sourceId) =>
        neutral.zeroFrom.has(sourceId) &&
        isAcSource(sourceId),
    ) || [...line.zeroFrom].some(
      (sourceId) =>
        neutral.plusFrom.has(sourceId) &&
        isAcSource(sourceId),
    );
    if (!powered) continue;

    mark(instance.id, electrical.positiveTerminal, "plusFrom");
    mark(instance.id, electrical.zeroTerminal, "zeroFrom");
  }

  // 変換後の DC 出力もダイオード等の先へ伝搬させる。
  spreadThroughDiodes(states, directionalEdges);

  return states;
};

/**
 * **静止状態** —— どのスイッチも操作されておらず、どのリレーも励磁していない ——
 * の入力。`wiring.ts`（静的な配線チェック）と `preview.ts`（静止状態の到達範囲）が
 * 共有する。
 */
export const AT_REST: SimulationInput = { pressedSwitches: new Set() };

/** 静止状態の切替集合。どのリレーの接点も動いていない */
export const NONE_ENERGIZED: ReadonlySet<string> = new Set();

/**
 * ネットを 1 回だけ解く。**収束ループは回らず、リレーは必ず非励磁のまま。**
 *
 * この 1 パスを見る用途が 2 つ（配線チェックと到達範囲の可視化）あり、
 * どちらも同じ 1 パスで足りる。**同じ 2 行を両方に書かない** —— 片方だけ
 * `openContacts` を渡すような食い違いが入ると、警告に出る回路と画面に出る色が
 * 別の状態を指すことになる。
 *
 * **スイッチの操作だけは入力として受け取る**（既定は `AT_REST` ＝ 無操作）。
 * スイッチは人が倒すもので、倒した結果は回路を解かなくても決まっている ——
 * だから 1 パスのままで扱える。**リレーの励磁は渡せない**（`NONE_ENERGIZED`
 * 固定）。リレーが動くと「動いた接点でまた別のリレーが動く」の連鎖になり、
 * それは収束ループ＝`simulate()` の領分になる（design.md §5.15）。
 */
export const solveWithoutRelays = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
  input: SimulationInput = AT_REST,
): NetLookup => {
  const nets = buildNets(document, definitions, input, NONE_ENERGIZED);
  return { netOf: nets.netOf, netState: computeNetStates(document, definitions, nets) };
};

/**
 * 部品の内部で **開いている** 端子ペア —— 今は通っていないが、
 * スイッチを操作するかリレーが動けば閉じる 2 端子 —— を返す。
 *
 * `conductingPairs()` の裏返し。**開閉の規則を書き直さない**ために、
 * 接点は `openContactPairs()`（relay.ts）へ委ね、ここではスイッチだけを見る。
 * 端子台は常時導通なので開くペアを持たない。
 *
 * 「電位がどこで止まっているか」を求めるのに要る（design.md §5.15）。
 * ネット ID からは「閉じれば繋がる 2 端子」が復元できないので、
 * `conductingPairs()` と同じ理由でここに置く。
 */
export const openPairs = (
  componentId: string,
  electrical: ElectricalDefinition,
  input: SimulationInput,
  energizedRelays: ReadonlySet<string>,
  operatedContacts?: OperatedContacts,
): TerminalPair[] => {
  switch (electrical.kind) {
    case "switch": {
      const operated = input.pressedSwitches.has(componentId);
      const closed = electrical.contactType === "NO" ? operated : !operated;
      return closed ? [] : [[electrical.terminalA, electrical.terminalB]];
    }
    case "relay":
      return openContactPairs(
        electrical.relay,
        energizedRelays.has(componentId),
        operatedContacts?.get(componentId),
      );
    case "terminal":
    case "power":
    case "ac-dc-power-supply":
    case "lamp":
    case "diode":
    case "analog-source":
    case "dimmer":
      // 調光器の AC は常時導通なので「閉じれば繋がる」端子を持たない
      return [];
  }
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
