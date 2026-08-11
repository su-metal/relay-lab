/**
 * 負荷 1 個の「どこを通って通電しているか」と「なぜ通電しないか」（design.md §5.11）。
 *
 * 配線の色は回路全体を一度に映すが、初めて回路を読む人の問いはいつも
 * 1 個の負荷に向いている —— **「このコイルは何を通って励磁しているのか」**、
 * そして動かないときの **「なぜ励磁しないのか」**。
 *
 * どちらも色では答えられない。前者は経路（どの端子を順に通るか）であり、
 * 後者は今そこに無いもの（届いていない電源と、手前で開いている接点）だから。
 * ここでは実端子番号のまま言葉にして返す。**抽象化された「リレー」ではなく
 * `端子 13 / 14` を扱えることが本プロダクトの価値**（CLAUDE.md）であり、
 * 経路の説明はそれが最も効く場所になる。
 *
 * **型番分岐は書かない**（CLAUDE.md 設計原則 2）。読むのは
 * `ElectricalDefinition` の 6 種と `RelayContact` の端子だけで、
 * 接点が何組あるか・c 接点か a 接点かは `ncTerminal` の有無から従う。
 *
 * **エンジンではなく adapter に置く。** §5.8・§5.9 と同じ理由で、これは
 * 電気的な真実ではなく**読み手のための切り分け**であり、`SimulationResult` と
 * 経路グラフから後段で導ける。
 *
 * このファイルは React を import しない純粋関数なので node 環境の Vitest で検証できる。
 */

import { conductingPairs, describeComponent, simulate } from "@/circuit/engine";
import type {
  CircuitComponentInstance,
  CircuitDocument,
  ComponentDefinition,
  ComponentDefinitionRegistry,
  ElectricalDefinition,
  SimulationResult,
} from "@/circuit/types";
import { terminalKey } from "@/circuit/types";

import { orientLoad } from "./current-flow";
import {
  PLUS_NODE,
  ZERO_NODE,
  isSupplyNode,
  orientedBridgesOnPath,
  reachableFrom,
  solvePathGraph,
  type PathGraph,
  type SolvedPathGraph,
} from "./path-graph";

/** 経路上で 1 個の部品を通過する区間 */
export type PathStep = {
  componentId: string;
  /** インスタンスの呼び名（未設定なら型番） */
  label: string;
  /**
   * この部品で通る端子のラベル。通る順。
   *
   * 配線で入って内部の接点を抜けるなら 2 個（`["9", "5"]`）、
   * 電源のように端点になるなら 1 個。
   */
  terminalLabels: string[];
};

export type PathRun = {
  /** 通る順の部品。電流の上流から下流へ */
  steps: PathStep[];
  /**
   * 途中に並列区間があり、一本道に絞れなかった。
   *
   * **「経路が無い」ではない。** 実際に 2 通り以上の道があるという意味で、
   * §5.10 が同じ区間に向きを出さないのと同じ理由（分流するので 1 本に決まらない）。
   */
  branched: boolean;
};

/** 負荷の端子 1 本が、どちらの電源に届いているか */
export type TerminalReach = {
  /** 端子のラベル（"14"） */
  label: string;
  reachesPlus: boolean;
  reachesZero: boolean;
  /** この端子に来ているべき電源。`orientation` で決まる */
  expects: "plus" | "zero";
};

/**
 * 経路の手前で開いている接点・スイッチ。
 *
 * **「開いている接点」を片端から全部並べるのではない。** 閉じれば
 * 実際に電源へ届く 1 枚だけを返す —— 関係ない接点まで挙げると、
 * どれを直せばいいのか分からなくなる。
 */
export type OpenGate = {
  componentId: string;
  label: string;
  /** 開いている 2 端子のラベル */
  terminalLabels: [string, string];
  /** 何をすれば閉じるか（"CR1 が励磁すると閉じます"） */
  condition: string;
  /** どちらの電源へ通じる扉か */
  supply: "plus" | "zero";
};

/** 経路が今どこで切れているか（`StartPath.breaks`） */
export type PathBreak = {
  componentId: string;
  label: string;
  /** 今は開いている 2 端子のラベル */
  terminalLabels: [string, string];
};

/**
 * 起動経路 —— **そのリレーが非励磁だったときに、コイルへ電気を入れた道**
 * （design.md §5.12）。
 *
 * 保持経路（`supplyRun` / `returnRun`）とは別物で、自己保持を組むと
 * **起動した瞬間に自分の接点が起動経路を切る**ことがよくある。そうなると
 * きっかけを作ったスイッチが画面上で完全に無関係に見える。
 */
export type StartPath = {
  /** 電源 + からコイルの入口まで */
  supply: PathRun;
  /** コイルの出口から 0V まで */
  back: PathRun;
  /**
   * この経路のうち、**今は開いている接点。** 空でないことが
   * 「起動経路はもう生きていない」の根拠になる。
   */
  breaks: PathBreak[];
};

/**
 * この負荷を落とす（消す）操作の候補（design.md §5.12）。
 *
 * **落ちないものも返す。** 「起動に使ったスイッチを戻せば落ちる」は
 * 自己保持回路では成り立たず、そこが最も誤解される点だから。
 */
export type ReleaseAction = {
  componentId: string;
  label: string;
  /** 操作の言い方（"OFF にする" / "押す" / "離す" / "ON にする"） */
  action: string;
  /**
   * 同じ操作の「〜しても」の形（"OFF にしても" / "押しても"）。
   *
   * **`action` から機械的に作らない。** 日本語の活用は語ごとに違い
   * （"押す" → "押しても"、"OFF にする" → "OFF にしても"）、
   * 文字列を継ぎ足すと「OFF にするしても」のような文が出る。
   */
  concessive: string;
  /** この操作で落ちるか */
  releases: boolean;
  /** そのスイッチが今操作されているか（ON 位置 / 押下中） */
  operated: boolean;
};

export type LoadPathExplanation = {
  componentId: string;
  /** コイルかランプか。UI の言い回し（"励磁" / "点灯"）の出し分けに使う */
  kind: "relay" | "lamp";
  /** 通電しているか */
  active: boolean;
  /** 通電中: 電源 + から負荷の入口まで */
  supplyRun?: PathRun;
  /** 通電中: 負荷の出口から 0V まで */
  returnRun?: PathRun;
  /** 通電中: 電流が入る端子 / 出る端子のラベル */
  inletLabel?: string;
  outletLabel?: string;
  /**
   * 通電中のリレーで、**起動経路が今は切れている**ときだけ入る。
   * 切れていない（今の経路がそのまま起動経路）なら省く —— 同じものを
   * 2 度並べると、どちらが今の経路なのか読めなくなる
   */
  startPath?: StartPath;
  /** 通電中: これを落とす操作の候補。停止中・非通電では省く */
  releases?: ReleaseAction[];
  /** 非通電: 両端がどちらの電源に届いているか */
  reach?: [TerminalReach, TerminalReach];
  /** 非通電: 閉じれば電源に届く接点。1 枚も無ければ空配列 */
  gates?: OpenGate[];
};

/** 負荷の 2 端子（コイルなら + / −、ランプなら A / B） */
const loadTerminalsOf = (
  electrical: ElectricalDefinition,
): [string, string] | null => {
  if (electrical.kind === "relay") {
    const { coil } = electrical.relay;
    return [coil.positiveTerminal, coil.negativeTerminal];
  }
  if (electrical.kind === "lamp") {
    return [electrical.terminalA, electrical.terminalB];
  }
  return null;
};

/** 部品の呼び名と端子ラベルを引くための索引 */
type Naming = {
  labelOf: (componentId: string) => string;
  terminalLabelOf: (componentId: string, terminalId: string) => string;
};

const buildNaming = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
): Naming => {
  const names = new Map<string, string>();
  const terminals = new Map<string, string>();

  for (const instance of document.components) {
    const definition = definitions.get(instance.definitionId);
    if (!definition) continue;
    names.set(instance.id, describeComponent(instance, definition));
    for (const terminal of definition.terminals) {
      terminals.set(terminalKey(instance.id, terminal.id), terminal.label);
    }
  }

  return {
    labelOf: (componentId) => names.get(componentId) ?? componentId,
    terminalLabelOf: (componentId, terminalId) =>
      terminals.get(terminalKey(componentId, terminalId)) ?? terminalId,
  };
};

/**
 * 向き付きの橋の列を、部品ごとの区間に畳む。
 *
 * 橋は「必ず通る辺」なので、並列区間を跨ぐと列が飛ぶ（前の辺の終点と
 * 次の辺の始点が一致しない）。**その飛びを `branched` として持ち上げる** ——
 * 黙って繋げると、通っていない端子を通ったことにしてしまう。
 */
const describeRun = (
  graph: PathGraph,
  naming: Naming,
  run: ReturnType<typeof orientedBridgesOnPath>,
  from: string,
  to: string,
): PathRun => {
  const nodes: string[] = [];
  let branched = false;

  for (const edge of run) {
    const last = nodes[nodes.length - 1];
    if (last === undefined) {
      nodes.push(edge.tail);
    } else if (last !== edge.tail) {
      branched = true;
      nodes.push(edge.tail);
    }
    nodes.push(edge.head);
  }

  /*
   * **両端も突き合わせる。** 橋どうしの飛びだけを見ていると、並列区間が
   * 経路の端（電源のすぐ先・負荷の直前）にある場合を取りこぼす —— そこには
   * 橋が 1 本も無いので「飛び」として現れない。
   * 端が合わなければ分岐であり、その端の端子を経路に足す。
   */
  if (nodes[0] !== from) {
    branched = true;
    nodes.unshift(from);
  }
  if (nodes[nodes.length - 1] !== to) {
    branched = true;
    nodes.push(to);
  }

  const steps: PathStep[] = [];
  for (const node of nodes) {
    // 仮想ノード（`@plus` / `@zero`）は端子ではないので経路には出さない
    if (isSupplyNode(node)) continue;
    const ref = graph.terminalOf.get(node);
    if (!ref) continue;

    const label = naming.terminalLabelOf(ref.componentId, ref.terminalId);
    const previous = steps[steps.length - 1];
    if (previous?.componentId === ref.componentId) {
      // 同じ部品を続けて通る（配線で入って接点を抜ける）ときは 1 区間にまとめる
      if (previous.terminalLabels[previous.terminalLabels.length - 1] !== label) {
        previous.terminalLabels.push(label);
      }
      continue;
    }
    steps.push({
      componentId: ref.componentId,
      label: naming.labelOf(ref.componentId),
      terminalLabels: [label],
    });
  }

  return { steps, branched };
};

/** 部品 1 個が持ちうる「閉じれば導通する端子ペア」と、閉じる条件 */
type GateCandidate = {
  a: string;
  b: string;
  /** その部品が今の状態のままなら何をすれば閉じるか */
  condition: string;
};

/**
 * 閉じうる端子ペアを列挙する。
 *
 * **開閉の規則そのものは書かない。** 今どれが閉じているかはエンジンの
 * `conductingPairs()` に聞き、ここが持つのは「そもそも開閉する組はどれか」
 * という定義の読み取りだけ（`inspection.ts` と同じ分担）。
 */
const gateCandidatesOf = (
  instance: CircuitComponentInstance,
  definition: ComponentDefinition,
  label: string,
): GateCandidate[] => {
  const { electrical } = definition;

  if (electrical.kind === "relay") {
    return electrical.relay.contacts.flatMap<GateCandidate>((contact) => {
      const pairs: GateCandidate[] = [
        {
          a: contact.commonTerminal,
          b: contact.noTerminal,
          condition: `${label} が励磁すると閉じます`,
        },
      ];
      // NC 端子が実機に無い a 接点（G7L など）に b 接点を作らない（design.md §4.8）
      if (contact.ncTerminal !== undefined) {
        pairs.push({
          a: contact.commonTerminal,
          b: contact.ncTerminal,
          condition: `${label} が非励磁に戻ると閉じます`,
        });
      }
      return pairs;
    });
  }

  if (electrical.kind === "switch") {
    const maintained = electrical.action === "maintained";
    // 今開いているのだから、A 接点は「まだ操作していない」、B 接点は「操作中」
    const condition =
      electrical.contactType === "NO"
        ? maintained
          ? `${label} を ON 位置にすると閉じます`
          : `${label} を押すと閉じます`
        : maintained
          ? `${label} を OFF 位置に戻すと閉じます`
          : `${label} を離すと閉じます`;
    return [{ a: electrical.terminalA, b: electrical.terminalB, condition }];
  }

  // 電源・負荷・端子台は開閉しない（端子台は常時導通）
  return [];
};

/** `conductingPairs` の結果を照合しやすい形に畳む */
const pairKey = (a: string, b: string): string =>
  a < b ? `${a}|${b}` : `${b}|${a}`;

/**
 * `from` の側から見て、閉じれば `supply` に届く接点を探す。
 *
 * 到達集合を 2 つ取るだけで求まる —— 負荷側から辿れる集合 `from` と、
 * 電源側から辿れる集合 `target`。**両側に足を掛けている開いた接点**が、
 * まさに切れ目にある扉。候補ごとに探索し直す必要はない。
 */
const findGates = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
  solved: SolvedPathGraph,
  naming: Naming,
  pressedSwitches: ReadonlySet<string>,
  energizedRelays: ReadonlySet<string>,
  fromNode: string,
  supply: "plus" | "zero",
): OpenGate[] => {
  const supplyNode = supply === "plus" ? PLUS_NODE : ZERO_NODE;
  const from = reachableFrom(solved.graph, fromNode);
  const target = reachableFrom(solved.graph, supplyNode);
  const gates: OpenGate[] = [];

  for (const instance of document.components) {
    const definition = definitions.get(instance.definitionId);
    if (!definition) continue;

    const label = naming.labelOf(instance.id);
    const closed = new Set(
      conductingPairs(
        instance.id,
        definition.electrical,
        { pressedSwitches },
        energizedRelays,
      ).map(([a, b]) => pairKey(a, b)),
    );

    for (const candidate of gateCandidatesOf(instance, definition, label)) {
      if (closed.has(pairKey(candidate.a, candidate.b))) continue;

      const keyA = terminalKey(instance.id, candidate.a);
      const keyB = terminalKey(instance.id, candidate.b);
      const bridgesGap =
        (from.has(keyA) && target.has(keyB)) ||
        (from.has(keyB) && target.has(keyA));
      if (!bridgesGap) continue;

      gates.push({
        componentId: instance.id,
        label,
        terminalLabels: [
          naming.terminalLabelOf(instance.id, candidate.a),
          naming.terminalLabelOf(instance.id, candidate.b),
        ],
        condition: candidate.condition,
        supply,
      });
    }
  }

  return gates;
};

/** `from` → `to` の道を 1 本の区間列にする。橋の取得と畳み込みをまとめただけ */
const runBetween = (
  solved: SolvedPathGraph,
  naming: Naming,
  from: string,
  to: string,
): PathRun =>
  describeRun(
    solved.graph,
    naming,
    orientedBridgesOnPath(
      solved.graph,
      solved.bridges,
      solved.componentOf,
      from,
      to,
    ),
    from,
    to,
  );

/**
 * 起動経路を求める（design.md §5.12）。
 *
 * **「そのリレーが非励磁だった瞬間」を作るのは、自分の励磁だけを外した状態。**
 * 他のリレーは今の状態のまま置く —— 全部落とすと回路の別の場所まで巻き戻り、
 * 実際に起動したときの経路とは違う道が出る。
 *
 * `simulate()` は回さない。要るのは経路グラフ 1 枚だけで、収束の結果
 * （どのリレーが最終的に上がるか）はここでは問わない。
 *
 * @returns 起動経路が**今も生きている**（切れた接点が無い）場合は `null`。
 *   今の経路と同じものを 2 度並べても読み手の助けにならない
 */
const startPathOf = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
  naming: Naming,
  pressedSwitches: ReadonlySet<string>,
  energizedRelays: ReadonlySet<string>,
  componentId: string,
  coilTerminals: readonly [string, string],
): StartPath | null => {
  const beforePickup = new Set(energizedRelays);
  beforePickup.delete(componentId);
  const before = solvePathGraph(
    document,
    definitions,
    pressedSwitches,
    beforePickup,
  );

  // 起動時にどちらの端子が + 側だったかは、その状態のグラフから読む
  const keys = coilTerminals.map((terminal) =>
    terminalKey(componentId, terminal),
  ) as [string, string];
  const reach = keys.map((key) => reachableFrom(before.graph, key));
  const inletIndex = reach.findIndex((set) => set.has(PLUS_NODE));
  if (inletIndex === -1) return null;
  const outletIndex = inletIndex === 0 ? 1 : 0;
  if (!reach[outletIndex].has(ZERO_NODE)) return null;

  const supply = runBetween(before, naming, PLUS_NODE, keys[inletIndex]);
  const back = runBetween(before, naming, keys[outletIndex], ZERO_NODE);

  /*
   * 起動経路のうち、**今は開いている**区間を拾う。ここが空でないことが
   * 「この経路はもう生きていない」の根拠になる。判定はエンジンの
   * `conductingPairs()` に聞く —— 開閉の規則を写さない。
   */
  const breaks: PathBreak[] = [];
  for (const step of [...supply.steps, ...back.steps]) {
    const instance = document.components.find(
      (component) => component.id === step.componentId,
    );
    const definition = instance
      ? definitions.get(instance.definitionId)
      : undefined;
    if (!instance || !definition) continue;

    const closed = new Set(
      conductingPairs(
        instance.id,
        definition.electrical,
        { pressedSwitches },
        energizedRelays,
      ).map(([a, b]) => pairKey(a, b)),
    );
    /*
     * **開閉する組だけを見る。** 区間の中には配線でつながっただけの端子ペアも
     * 混じる（同じリレーの `2 → 14` のように、接点ではなく電線で結ばれた 2 端子は
     * 1 区間に畳まれる）。それを「今は導通していない」と数えると、
     * 切れてもいない場所を切れたと言うことになる。
     */
    const switchable = new Set(
      gateCandidatesOf(instance, definition, step.label).map((candidate) =>
        pairKey(candidate.a, candidate.b),
      ),
    );
    // 区間は端子ラベルで持っているので、定義側の端子 ID へ戻す
    const idOf = (label: string) =>
      definition.terminals.find((terminal) => terminal.label === label)?.id;

    for (let index = 0; index + 1 < step.terminalLabels.length; index += 1) {
      const a = idOf(step.terminalLabels[index]);
      const b = idOf(step.terminalLabels[index + 1]);
      if (!a || !b) continue;
      if (!switchable.has(pairKey(a, b))) continue;
      if (closed.has(pairKey(a, b))) continue;
      breaks.push({
        componentId: instance.id,
        label: step.label,
        terminalLabels: [
          step.terminalLabels[index],
          step.terminalLabels[index + 1],
        ],
      });
    }
  }

  if (breaks.length === 0) return null;
  return { supply, back, breaks };
};

/**
 * この負荷を落とす操作の候補を求める（design.md §5.12）。
 *
 * スイッチ 1 個ずつ「操作を反転させたら落ちるか」を `simulate()` で問う。
 * 反転なので**起動系（ON を OFF に戻す）と停止系（b 接点を押す）の両方**が
 * 同じ 1 つの規則で出る。
 *
 * **落ちない候補も返す。** 自己保持回路では「起動に使ったスイッチを戻せば
 * 落ちる」が成り立たず、そこが最も誤解される点だから（UI が言い分ける）。
 *
 * 現在の励磁集合を `previousEnergizedRelays` に渡すのが要点 —— 渡さないと
 * 双安定な自己保持が毎回解けてしまい、どの操作でも「落ちる」と答える（§3.4）。
 */
const releaseActionsOf = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
  naming: Naming,
  result: SimulationResult,
  pressedSwitches: ReadonlySet<string>,
  componentId: string,
  kind: "relay" | "lamp",
): ReleaseAction[] => {
  const actions: ReleaseAction[] = [];

  for (const instance of document.components) {
    const definition = definitions.get(instance.definitionId);
    if (!definition || definition.electrical.kind !== "switch") continue;

    const operated = pressedSwitches.has(instance.id);
    const flipped = new Set(pressedSwitches);
    if (operated) flipped.delete(instance.id);
    else flipped.add(instance.id);

    const whatIf = simulate(document, definitions, {
      pressedSwitches: flipped,
      previousEnergizedRelays: result.energizedRelays,
    });
    const stillOn =
      kind === "relay"
        ? whatIf.energizedRelays.has(componentId)
        : whatIf.litLamps.has(componentId);

    const label = naming.labelOf(instance.id);
    const maintained = definition.electrical.action === "maintained";
    const wording = operated
      ? maintained
        ? { action: "OFF にする", concessive: "OFF にしても" }
        : { action: "離す", concessive: "離しても" }
      : maintained
        ? { action: "ON にする", concessive: "ON にしても" }
        : { action: "押す", concessive: "押しても" };

    // 落ちない候補は、**今操作しているスイッチだけ**残す。触っていない
    // スイッチまで「これでは落ちません」と並べるとただの雑音になる
    if (!stillOn || operated) {
      actions.push({
        componentId: instance.id,
        label,
        ...wording,
        releases: !stillOn,
        operated,
      });
    }
  }

  return actions;
};

/**
 * 負荷 1 個の経路を説明する。
 *
 * @param componentId リレーまたはランプのインスタンス ID
 * @returns 部品が見つからない・負荷でない・停止中は `null`。
 *   **停止中に `null` を返すのは意図的** —— 動かしていない回路について
 *   「励磁していません」と言うと、消磁しているのか動いていないのかが
 *   区別できなくなる（design.md §8.2 と同じ約束）
 */
export const explainLoadPath = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
  result: SimulationResult | null,
  pressedSwitches: ReadonlySet<string>,
  componentId: string | undefined,
): LoadPathExplanation | null => {
  if (!result || !componentId) return null;

  const instance = document.components.find(
    (component) => component.id === componentId,
  );
  if (!instance) return null;
  const definition = definitions.get(instance.definitionId);
  if (!definition) return null;

  const { electrical } = definition;
  const terminals = loadTerminalsOf(electrical);
  if (!terminals) return null;
  const kind = electrical.kind === "relay" ? "relay" : "lamp";

  const active =
    kind === "relay"
      ? result.energizedRelays.has(instance.id)
      : result.litLamps.has(instance.id);

  const naming = buildNaming(document, definitions);
  const solved = solvePathGraph(
    document,
    definitions,
    pressedSwitches,
    result.energizedRelays,
  );

  if (active) {
    const oriented = orientLoad(result, instance.id, terminals[0], terminals[1]);
    if (!oriented) return { componentId: instance.id, kind, active };

    const inlet = solved.graph.terminalOf.get(oriented.inlet);
    const outlet = solved.graph.terminalOf.get(oriented.outlet);

    return {
      componentId: instance.id,
      kind,
      active: true,
      inletLabel: inlet
        ? naming.terminalLabelOf(inlet.componentId, inlet.terminalId)
        : undefined,
      outletLabel: outlet
        ? naming.terminalLabelOf(outlet.componentId, outlet.terminalId)
        : undefined,
      // 電流の上流を `from` に置くと、返る `tail → head` がそのまま流れる向きになる
      supplyRun: runBetween(solved, naming, PLUS_NODE, oriented.inlet),
      returnRun: runBetween(solved, naming, oriented.outlet, ZERO_NODE),
      /*
       * 起動経路（§5.12）。**リレーだけ。** 「自分が非励磁だった瞬間」は
       * 自分の励磁を外して作るもので、接点を持たないランプには定義できない。
       * 今も生きている（切れた接点が無い）場合は `null` が返り、省かれる
       */
      startPath:
        kind === "relay"
          ? (startPathOf(
              document,
              definitions,
              naming,
              pressedSwitches,
              result.energizedRelays,
              instance.id,
              terminals,
            ) ?? undefined)
          : undefined,
      releases: releaseActionsOf(
        document,
        definitions,
        naming,
        result,
        pressedSwitches,
        instance.id,
        kind,
      ),
    };
  }

  /*
   * 非通電。どちらの端子がどちらの電源を待っているかを決める。
   *
   * **定義上の + 端子を決め打たない。** 極性なしのコイルは逆接でも励磁する
   * ので（§5.3）、すでに片側に電源が来ているならその向きを尊重する。
   * 両側とも何も来ていなければ定義どおりの向き（+ 端子が + を待つ）に倒す。
   */
  const keys = [
    terminalKey(instance.id, terminals[0]),
    terminalKey(instance.id, terminals[1]),
  ] as const;
  const reachSets = [
    reachableFrom(solved.graph, keys[0]),
    reachableFrom(solved.graph, keys[1]),
  ] as const;
  const hits = reachSets.map((set) => ({
    plus: set.has(PLUS_NODE),
    zero: set.has(ZERO_NODE),
  }));

  const asDefined = (hits[0].plus ? 1 : 0) + (hits[1].zero ? 1 : 0);
  const swapped = (hits[0].zero ? 1 : 0) + (hits[1].plus ? 1 : 0);
  const expects: ["plus" | "zero", "plus" | "zero"] =
    swapped > asDefined ? ["zero", "plus"] : ["plus", "zero"];

  const reach = [0, 1].map<TerminalReach>((index) => ({
    label: naming.terminalLabelOf(instance.id, terminals[index]),
    reachesPlus: hits[index].plus,
    reachesZero: hits[index].zero,
    expects: expects[index],
  })) as [TerminalReach, TerminalReach];

  const gates: OpenGate[] = [];
  for (const index of [0, 1] as const) {
    const supply = expects[index];
    if (hits[index][supply]) continue;
    gates.push(
      ...findGates(
        document,
        definitions,
        solved,
        naming,
        pressedSwitches,
        result.energizedRelays,
        keys[index],
        supply,
      ),
    );
  }

  return { componentId: instance.id, kind, active: false, reach, gates };
};

/**
 * 表示用に、経路の両端から**負荷そのものの端子**を外す。
 *
 * `supplyRun` は負荷の入口で終わり、`returnRun` は出口から始まる —— どちらも
 * 経路の記述としては正しいが、画面では負荷を 1 行の見出し（「コイル 14 → 13」）で
 * 出すので、そのままだと同じ端子が 2 度並ぶ。
 *
 * **外すのは端の 1 個だけ。** 自己保持のようにリレー自身の接点を経由して
 * いる場合、同じ区間に `9 → 5 → 14` と並ぶ —— ここで区間ごと落とすと
 * 「何がこのコイルを保持しているのか」という肝心の情報が消える。
 */
const trimRuns = (
  componentId: string,
  supplySteps: readonly PathStep[] | undefined,
  backSteps: readonly PathStep[] | undefined,
): { supply: PathStep[]; back: PathStep[] } => {
  const trim = (steps: readonly PathStep[], edge: "last" | "first") => {
    const copy = steps.map((step) => ({
      ...step,
      terminalLabels: [...step.terminalLabels],
    }));
    const index = edge === "last" ? copy.length - 1 : 0;
    const step = copy[index];
    if (!step || step.componentId !== componentId) return copy;
    if (edge === "last") step.terminalLabels.pop();
    else step.terminalLabels.shift();
    if (step.terminalLabels.length === 0) copy.splice(index, 1);
    return copy;
  };

  return {
    supply: trim(supplySteps ?? [], "last"),
    back: trim(backSteps ?? [], "first"),
  };
};

export const trimLoadEnds = (
  explanation: LoadPathExplanation,
): { supply: PathStep[]; back: PathStep[] } =>
  trimRuns(
    explanation.componentId,
    explanation.supplyRun?.steps,
    explanation.returnRun?.steps,
  );

/** 起動経路（§5.12）にも同じ整形をかける */
export const trimStartPath = (
  explanation: LoadPathExplanation,
): { supply: PathStep[]; back: PathStep[] } =>
  trimRuns(
    explanation.componentId,
    explanation.startPath?.supply.steps,
    explanation.startPath?.back.steps,
  );
