/**
 * 実体配線からラダー図への変換（design.md §5.16）。
 *
 * キャンバスに描いてあるのは**実体配線図** —— どの端子とどの端子を電線で
 * 結んだか —— で、実務で回路を読むときに使うラダー図とは形が違う。
 * ラダー図は「左の母線から右の母線へ向かって、条件（接点）を通って
 * 出力（コイル・ランプ）に至る横棒」の列であり、**配線の位置ではなく
 * 論理の直列・並列**だけを見る。
 *
 * ここでやるのは 1 方向の生成（実体配線 → ラダー図）だけ。
 * 逆変換（ラダー図を描いたら配線が出る）は範囲外
 * （`requirements_definition.md` §8）—— 実端子への割り当てが一意に決まらない。
 *
 * ## 何を辺にするか
 *
 * `engine/graph.ts` のネットは**いま閉じている接点**を union するが、ここでは
 * **接点は開閉に関わらず枝のまま残す。** ラダー図は状態のスナップショットでは
 * なく回路の論理そのものなので、「今どちらへ倒れているか」を織り込んでは
 * ならない。だから `conductingPairs()` は使わず、接点はすべて枝として扱う。
 *
 * union するのは電線と端子台だけ。負荷（コイル・ランプ）は §5.2 のとおり
 * union せず、ここでは**出力そのもの**として段の右端に置く。
 *
 * **型番分岐は書かない**（CLAUDE.md 設計原則 2）。読むのは
 * `ElectricalDefinition` と `RelayContact` の端子だけで、a 接点しか持たない
 * リレー（G7L）は `ncTerminal` が無いぶん b 接点の枝が出ない、で足りる。
 *
 * **エンジンではなく adapter に置く。** §5.8・§5.9・§5.11 と同じ理由で、
 * これは電気的な真実ではなく**読み手のための言い換え**であり、
 * `CircuitDocument` から後段で導ける。ラダー図は保存対象ではない。
 *
 * このファイルは React を import しない純粋関数なので node 環境の Vitest で検証できる。
 */

import { UnionFind, describeComponent } from "@/circuit/engine";
import type {
  CircuitDocument,
  ComponentDefinition,
  ComponentDefinitionRegistry,
  TimerDelay,
} from "@/circuit/types";
import { terminalKey, terminalRefKey } from "@/circuit/types";

import { PLUS_NODE, ZERO_NODE } from "./path-graph";

/** ラダー図に置く接点 1 枚 */
export type LadderContact = {
  componentId: string;
  /** インスタンスの呼び名（未設定なら型番） */
  label: string;
  /** a 接点（`no`）か b 接点（`nc`）か */
  kind: "no" | "nc";
  /** 通る 2 端子のラベル。リレーは [COM, NO/NC] の順 */
  terminalLabels: [string, string];
  /** 手で操作する接点（スイッチ）か、コイルが動かす接点か */
  operatedBy: "hand" | "coil";
  /** 限時接点の向き。タイマーの接点だけが持つ（design.md §5.13） */
  delay?: TimerDelay["mode"];
  /** 手で操作する接点のうち、離しても位置が残るもの（オルタネート） */
  maintained?: boolean;
};

/**
 * 段の条件式。接点を葉とする直列・並列の木。
 *
 * **論理式（AND / OR）ではなく回路の形として持つ。** 現場で読むのは
 * 「この接点とこの接点が横に並んでいる」という形そのもので、
 * 論理式に潰すと接点の重複や順序が変わり、実配線と照らせなくなる。
 */
export type LadderExpr =
  | { kind: "contact"; contact: LadderContact }
  | { kind: "series"; items: LadderExpr[] }
  | { kind: "parallel"; items: LadderExpr[] };

/** 段の右端に置く出力（コイル・ランプ） */
export type LadderOutput = {
  componentId: string;
  label: string;
  kind: "coil" | "lamp";
  /** 端子のラベル。コイルは定義順（+ 側 → − 側） */
  terminalLabels: [string, string];
  /** 限時の向き。タイマーのコイルだけが持つ */
  delay?: TimerDelay["mode"];
};

/** ラダー図 1 段 */
export type LadderRung = {
  output: LadderOutput;
  /**
   * 左の母線から出力までの条件。
   *
   * `undefined` は**条件が 1 枚も無い**（母線に直結）という意味で、
   * 「変換できなかった」ではない。後者は `blocked` に理由が入る。
   */
  condition?: LadderExpr;
  /**
   * 0V 側にあった接点を左へ移したか（design.md §5.16）。
   *
   * 実配線では接点をコイルの 0V 側に入れることがあるが、ラダー図は
   * 条件をすべて出力の左に置く形なので、移したことを言えるようにしておく。
   */
  movedFromZeroSide: boolean;
  /** 図にできなかった理由。あるときは `condition` を持たない */
  blocked?: string;
};

export type LadderDiagram = {
  rungs: LadderRung[];
  /** 図に出せなかったもの・読むときの断り書き */
  notes: string[];
};

/** 直列にまとめる。入れ子の直列は平らにする（読みは変わらない） */
const seriesOf = (items: LadderExpr[]): LadderExpr => {
  const flat = items.flatMap((item) =>
    item.kind === "series" ? item.items : [item],
  );
  return flat.length === 1 ? flat[0] : { kind: "series", items: flat };
};

/** 並列にまとめる。入れ子の並列は平らにする */
const parallelOf = (items: LadderExpr[]): LadderExpr => {
  const flat = items.flatMap((item) =>
    item.kind === "parallel" ? item.items : [item],
  );
  return flat.length === 1 ? flat[0] : { kind: "parallel", items: flat };
};

/**
 * 式の読む向きを反転する。
 *
 * 枝は無向なので、直列にまとめる段階で「どちら向きに読む枝か」が
 * 揃っていないことがある。**並列の枝の順序は入れ替えない** ——
 * 上下の並びが変わるだけで意味は同じだが、図が回ごとに揺れる。
 */
const reverseExpr = (expr: LadderExpr): LadderExpr => {
  switch (expr.kind) {
    case "contact":
      return expr;
    case "series":
      return {
        kind: "series",
        items: [...expr.items].reverse().map(reverseExpr),
      };
    case "parallel":
      return { kind: "parallel", items: expr.items.map(reverseExpr) };
  }
};

/** 縮約中の枝。`u` から `v` へ読む向きで `expr` を持つ */
type Branch = { u: string; v: string; expr: LadderExpr };

type Reduction =
  /** `expr` が無いのは母線と出力が直結している（条件が 1 枚も無い）とき */
  | { status: "ok"; expr?: LadderExpr }
  | { status: "disconnected" }
  | { status: "not-series-parallel" };

const otherEnd = (branch: Branch, node: string): string =>
  branch.u === node ? branch.v : branch.u;

/** `node` で終わる向きに読み替えた式 */
const exprEndingAt = (branch: Branch, node: string): LadderExpr =>
  branch.v === node ? branch.expr : reverseExpr(branch.expr);

/** `node` から始まる向きに読み替えた式 */
const exprStartingAt = (branch: Branch, node: string): LadderExpr =>
  branch.u === node ? branch.expr : reverseExpr(branch.expr);

const isConnected = (
  branches: readonly Branch[],
  source: string,
  sink: string,
): boolean => {
  const adjacency = new Map<string, string[]>();
  for (const branch of branches) {
    for (const [from, to] of [
      [branch.u, branch.v],
      [branch.v, branch.u],
    ]) {
      const list = adjacency.get(from);
      if (list) list.push(to);
      else adjacency.set(from, [to]);
    }
  }
  const seen = new Set([source]);
  const stack = [source];
  while (stack.length > 0) {
    const node = stack.pop() as string;
    if (node === sink) return true;
    for (const next of adjacency.get(node) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(next);
    }
  }
  return false;
};

/**
 * 2 端子網を直列・並列に縮約する（design.md §5.16）。
 *
 * 規則は 3 つだけを繰り返す。
 *
 * 1. **並列** … 同じ 2 端点を結ぶ枝どうしを 1 本にまとめる
 * 2. **直列** … 端点でも分岐点でもない次数 2 の節点を消して 1 本にまとめる
 * 3. **刈り取り** … 行き止まり（次数 1 の節点）の枝を捨てる。電流が通らないので
 *    ラダー図にも出ない
 *
 * どれも枝か節点を 1 つ減らすので必ず止まる。1 本に潰れなければ、その回路は
 * **直列と並列だけでは表せない**（ブリッジ回路）。そのときは近い形を出さずに
 * そう言って諦める —— 「だいたい合っている図」は実配線と照らす道具にならない。
 */
const reduceNetwork = (
  input: readonly Branch[],
  source: string,
  sink: string,
): Reduction => {
  if (source === sink) return { status: "ok" };
  // 自己ループ（両端が同じ節点に落ちる枝）は電流を運ばない
  let branches = input.filter((branch) => branch.u !== branch.v);
  if (!isConnected(branches, source, sink)) return { status: "disconnected" };

  for (;;) {
    const incidence = new Map<string, Branch[]>();
    for (const branch of branches) {
      for (const node of [branch.u, branch.v]) {
        const list = incidence.get(node);
        if (list) list.push(branch);
        else incidence.set(node, [branch]);
      }
    }

    // 1. 並列
    const pairs = new Map<string, Branch[]>();
    for (const branch of branches) {
      const key = [branch.u, branch.v].sort().join(" ");
      const list = pairs.get(key);
      if (list) list.push(branch);
      else pairs.set(key, [branch]);
    }
    const parallelGroup = [...pairs.values()].find((list) => list.length > 1);
    if (parallelGroup) {
      const [first, ...rest] = parallelGroup;
      const merged: Branch = {
        u: first.u,
        v: first.v,
        expr: parallelOf([
          first.expr,
          ...rest.map((branch) => exprStartingAt(branch, first.u)),
        ]),
      };
      branches = branches.filter((branch) => !parallelGroup.includes(branch));
      branches.push(merged);
      continue;
    }

    // 2. 直列
    const seriesNode = [...incidence.entries()].find(
      ([node, incident]) =>
        node !== source && node !== sink && incident.length === 2,
    );
    if (seriesNode) {
      const [node, [first, second]] = seriesNode;
      const merged: Branch = {
        u: otherEnd(first, node),
        v: otherEnd(second, node),
        expr: seriesOf([
          exprEndingAt(first, node),
          exprStartingAt(second, node),
        ]),
      };
      branches = branches.filter(
        (branch) => branch !== first && branch !== second,
      );
      branches.push(merged);
      continue;
    }

    // 3. 刈り取り
    const deadEnd = [...incidence.entries()].find(
      ([node, incident]) =>
        node !== source && node !== sink && incident.length === 1,
    );
    if (deadEnd) {
      const [, [branch]] = deadEnd;
      branches = branches.filter((entry) => entry !== branch);
      continue;
    }

    break;
  }

  if (branches.length !== 1) return { status: "not-series-parallel" };
  const [last] = branches;
  const spansEnds =
    (last.u === source && last.v === sink) ||
    (last.u === sink && last.v === source);
  if (!spansEnds) return { status: "not-series-parallel" };
  return { status: "ok", expr: exprStartingAt(last, source) };
};

/** 接点として取り出した枝 1 本 */
type ContactEdge = { a: string; b: string; contact: LadderContact };

/** 出力（コイル・ランプ）1 個 */
type LoadEdge = {
  componentId: string;
  a: string;
  b: string;
  output: LadderOutput;
  /** 図面での位置。段を上から下へ並べるのに使う */
  order: { x: number; y: number };
};

const labelOf = (definition: ComponentDefinition, terminalId: string): string =>
  definition.terminals.find((terminal) => terminal.id === terminalId)?.label ??
  terminalId;

/**
 * 実体配線をラダー図に変換する。
 *
 * 電源は 1 組の母線（左 = + 側 / 右 = 0V 側）に束ねる。電源が 2 台以上あっても
 * 母線は 1 組にまとめ、その旨を `notes` に出す —— ラダー図に電源の台数を
 * 表す場所が無いため、黙って束ねると別系統の回路が 1 枚の図に見える。
 */
export const buildLadder = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
): LadderDiagram => {
  const dsu = new UnionFind();
  const notes: string[] = [];

  // 1. 電線と端子台、電源の母線を束ねる（接点と負荷は束ねない）
  for (const connection of document.connections) {
    dsu.union(terminalRefKey(connection.from), terminalRefKey(connection.to));
  }

  let powerCount = 0;
  let diodeCount = 0;
  /** 調光出力の台数。図に出さないことを断るためだけに数える（§5.17） */
  let dimmerCount = 0;

  for (const instance of document.components) {
    const definition = definitions.get(instance.definitionId);
    if (!definition) continue;
    const { electrical } = definition;
    if (electrical.kind === "terminal") {
      for (const terminalId of electrical.terminals.slice(1)) {
        dsu.union(
          terminalKey(instance.id, electrical.terminals[0]),
          terminalKey(instance.id, terminalId),
        );
      }
    }
    if (electrical.kind === "power") {
      powerCount += 1;
      dsu.union(
        terminalKey(instance.id, electrical.positiveTerminal),
        PLUS_NODE,
      );
      dsu.union(terminalKey(instance.id, electrical.zeroTerminal), ZERO_NODE);
    }
    if (electrical.kind === "diode") diodeCount += 1;
    if (electrical.kind === "analog-source") dimmerCount += 1;
  }

  // 2. 接点と出力を拾う
  const contacts: ContactEdge[] = [];
  const loads: LoadEdge[] = [];

  for (const instance of document.components) {
    const definition = definitions.get(instance.definitionId);
    if (!definition) continue;
    const { electrical } = definition;
    const name = describeComponent(instance, definition);
    const node = (terminalId: string): string =>
      dsu.find(terminalKey(instance.id, terminalId));

    switch (electrical.kind) {
      case "switch":
        contacts.push({
          a: node(electrical.terminalA),
          b: node(electrical.terminalB),
          contact: {
            componentId: instance.id,
            label: name,
            kind: electrical.contactType === "NO" ? "no" : "nc",
            terminalLabels: [
              labelOf(definition, electrical.terminalA),
              labelOf(definition, electrical.terminalB),
            ],
            operatedBy: "hand",
            maintained: electrical.action === "maintained" || undefined,
          },
        });
        break;
      case "relay": {
        const { relay, delay } = electrical;
        for (const contact of relay.contacts) {
          /*
           * b 接点の端子は実機に無いことがある（G7L・CLAUDE.md 設計原則 6）。
           * 見ているのは端子の有無だけで、接点の形の名前も型番も見ない
           */
          const branches: [string | undefined, "no" | "nc"][] = [
            [contact.noTerminal, "no"],
            [contact.ncTerminal, "nc"],
          ];
          for (const [terminalId, kind] of branches) {
            if (terminalId === undefined) continue;
            contacts.push({
              a: node(contact.commonTerminal),
              b: node(terminalId),
              contact: {
                componentId: instance.id,
                label: name,
                kind,
                terminalLabels: [
                  labelOf(definition, contact.commonTerminal),
                  labelOf(definition, terminalId),
                ],
                operatedBy: "coil",
                delay: delay?.mode,
              },
            });
          }
        }
        /*
         * **コイルが無ければラダー図の出力にならない**（design.md §4.16）。
         * カットリレーや操作卓のボタンは接点を持つが、母線間に置く
         * 「出力」ではない —— 接点は上の枝として既に出ている。
         */
        if (!relay.coil) break;
        loads.push({
          componentId: instance.id,
          a: node(relay.coil.positiveTerminal),
          b: node(relay.coil.negativeTerminal),
          order: instance.position,
          output: {
            componentId: instance.id,
            label: name,
            kind: "coil",
            terminalLabels: [
              labelOf(definition, relay.coil.positiveTerminal),
              labelOf(definition, relay.coil.negativeTerminal),
            ],
            delay: delay?.mode,
          },
        });
        break;
      }
      case "lamp":
        loads.push({
          componentId: instance.id,
          a: node(electrical.terminalA),
          b: node(electrical.terminalB),
          order: instance.position,
          output: {
            componentId: instance.id,
            label: name,
            kind: "lamp",
            terminalLabels: [
              labelOf(definition, electrical.terminalA),
              labelOf(definition, electrical.terminalB),
            ],
          },
        });
        break;
      case "power":
      case "terminal":
      case "diode":
      case "analog-source":
        /*
         * ダイオードは枝にしない（下の `notes` で断る）。
         *
         * **調光出力も同じ。** ラダー図は接点の論理を表す図で、
         * 0–10V のアナログ量を描く場所が無い（design.md §5.17）。
         * 調光ランプ自体は普通のランプとして出力に出るので、
         * 「どの条件でこのランプに電源が入るか」までは図に残る。
         */
        break;
    }
  }

  // 3. 段を組む。接点の網は出力ごとに変わらないので枝は 1 度だけ作る
  const branches: Branch[] = contacts.map(({ a, b, contact }) => ({
    u: a,
    v: b,
    expr: { kind: "contact", contact },
  }));

  const plus = dsu.find(PLUS_NODE);
  const zero = dsu.find(ZERO_NODE);

  const reachableFrom = (start: string): Set<string> => {
    const seen = new Set([start]);
    const stack = [start];
    while (stack.length > 0) {
      const node = stack.pop() as string;
      for (const branch of branches) {
        if (branch.u !== node && branch.v !== node) continue;
        const next = otherEnd(branch, node);
        if (seen.has(next)) continue;
        seen.add(next);
        stack.push(next);
      }
    }
    return seen;
  };
  const fromPlus = reachableFrom(plus);
  const fromZero = reachableFrom(zero);

  /**
   * 出力のどちらの端子が + 側か。
   *
   * **コイルの極性で決めない。** 実配線ではコイルの − 側に接点を入れる
   * 書き方も普通にあり（自己保持を 0V 側に組む形・design.md §5.9）、
   * 極性で決め打つと図が左右さかさまになる。母線からの到達で決める。
   */
  const orient = (load: LoadEdge): { inNode: string; outNode: string } => {
    if (fromPlus.has(load.a) && fromZero.has(load.b)) {
      return { inNode: load.a, outNode: load.b };
    }
    if (fromPlus.has(load.b) && fromZero.has(load.a)) {
      return { inNode: load.b, outNode: load.a };
    }
    // 片側しか届いていない回路。届いているほうを手掛かりに向きを決め、
    // 足りない側は `reduceNetwork` が `disconnected` として言う
    if (fromPlus.has(load.b) || fromZero.has(load.a)) {
      return { inNode: load.b, outNode: load.a };
    }
    return { inNode: load.a, outNode: load.b };
  };

  // 上から下へ読むものなので、図面での位置の順に並べる（design.md §8.15）
  const ordered = [...loads].sort(
    (a, b) =>
      a.order.y - b.order.y ||
      a.order.x - b.order.x ||
      a.componentId.localeCompare(b.componentId),
  );

  const rungs: LadderRung[] = [];

  for (const load of ordered) {
    const { inNode, outNode } = orient(load);
    const left = reduceNetwork(branches, plus, inNode);
    const right = reduceNetwork(branches, outNode, zero);

    if (left.status !== "ok" || right.status !== "ok") {
      const blocked =
        left.status === "disconnected"
          ? "+ 側の母線に届いていません（配線が途中です）。"
          : right.status === "disconnected"
            ? "0V 側の母線に届いていません（配線が途中です）。"
            : "直列と並列だけでは表せない配線です（ブリッジ状に繋がっています）。";
      rungs.push({ output: load.output, movedFromZeroSide: false, blocked });
      continue;
    }

    const parts = [left.expr, right.expr].filter(
      (expr): expr is LadderExpr => expr !== undefined,
    );
    rungs.push({
      output: load.output,
      condition: parts.length === 0 ? undefined : seriesOf(parts),
      movedFromZeroSide: right.expr !== undefined,
    });
  }

  // 4. 断り書き
  if (powerCount === 0) {
    notes.push(
      "電源が置かれていないため、母線が決まりません。電源を置いて配線すると段が出ます。",
    );
  }
  if (powerCount > 1) {
    notes.push(
      `電源が ${powerCount} 台あります。ラダー図には電源の台数を表す場所が無いため、1 組の母線にまとめています。`,
    );
  }
  if (diodeCount > 0) {
    notes.push(
      "ダイオードは図に出していません。逆起電力を吸収する実装上の部品で、ラダー図の論理には現れないためです（直列に入れた場合もその経路は数えていません）。",
    );
  }
  if (dimmerCount > 0) {
    notes.push(
      "調光（0–10V）は図に出していません。ラダー図は接点の論理を表す図で、アナログ量を描く場所が無いためです。調光信号を接点で 0V に落とす配線も段にはなりません（明るさはキャンバスで確認してください）。",
    );
  }
  if (rungs.some((rung) => rung.movedFromZeroSide)) {
    notes.push(
      "コイルの 0V 側にある接点は、ラダー図の決まりに合わせて出力の左へ移しています。実配線での位置はキャンバスで確認してください。",
    );
  }

  return { rungs, notes };
};

/** 接点 1 枚の読み（`RY1 9-5[a]`）。図の代わりに読める形で、読み上げと検証に使う */
const contactText = (contact: LadderContact): string => {
  const kind = `${contact.delay ? "限" : ""}${contact.kind === "no" ? "a" : "b"}`;
  return `${contact.label} ${contact.terminalLabels[0]}-${contact.terminalLabels[1]}[${kind}]`;
};

/** 条件式の読み。直列は長音符でつなぎ、並列は括弧で囲む */
export const exprText = (expr: LadderExpr): string => {
  switch (expr.kind) {
    case "contact":
      return contactText(expr.contact);
    case "series":
      return expr.items.map(exprText).join(" — ");
    case "parallel":
      return `(${expr.items.map(exprText).join(" ∥ ")})`;
  }
};

/**
 * 段 1 本の読み。
 *
 * 画面の読み上げ（`aria-label`）と検証で共用する。**図と文を別々に
 * 組み立てない** —— 片方だけ直す事故が起きる。
 */
export const rungText = (rung: LadderRung): string => {
  const output = `${rung.output.label} ${
    rung.output.kind === "coil" ? "コイル" : "ランプ"
  } ${rung.output.terminalLabels[0]}-${rung.output.terminalLabels[1]}`;
  if (rung.blocked) return `${output}：${rung.blocked}`;
  const condition = rung.condition ? exprText(rung.condition) : "（条件なし）";
  return `${condition} → ${output}`;
};
