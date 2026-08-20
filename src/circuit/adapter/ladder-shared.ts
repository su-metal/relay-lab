/**
 * 同じ実接点を 1 回だけ描くための、共有配線ラダー表現。
 *
 * `ladder.ts` の 1 出力 = 1 段という表現は、単純な自己保持回路には読みやすい。
 * 一方、1 枚の実接点の先から複数の負荷へ分岐する回路を出力ごとに展開すると、
 * 同じ端子対（例: RY1 9-5）が複数段へ複製され、実機に接点が複数あるように
 * 見えてしまう。このモジュールはその場合だけ使う「実接点 1 枚 = 図記号 1 個」の
 * 共有ネットワークを組み立てる。
 *
 * 保存データは増やさない。CircuitDocument から毎回導く派生表現である。
 */

import { UnionFind, describeComponent } from "@/circuit/engine";
import type {
  CircuitDocument,
  ComponentDefinition,
  ComponentDefinitionRegistry,
  TimerDelay,
} from "@/circuit/types";
import { terminalKey, terminalRefKey } from "@/circuit/types";

import type {
  LadderContact,
  LadderDiagram,
  LadderExpr,
  LadderOutput,
} from "./ladder";
import { PLUS_NODE, ZERO_NODE } from "./path-graph";

export type SharedLadderEdge = {
  /** 物理要素を一意に指す。実接点は同じ id で 2 回出してはならない。 */
  id: string;
  from: string;
  to: string;
  order: number;
} & (
  | { kind: "contact"; contact: LadderContact }
  | { kind: "output"; output: LadderOutput }
);

export type SharedLadderNetwork = {
  plus: string;
  zero: string;
  edges: SharedLadderEdge[];
  /** 0V 側の条件を出力の左へ移した場合に表示する注記。 */
  movedZeroSide: boolean;
  /** 標準形へ安全に並べ替えられず、実配線の向きを保った場合。 */
  wiringFaithfulFallback: boolean;
};

type ContactEdge = {
  id: string;
  a: string;
  b: string;
  order: number;
  contact: LadderContact;
};

type LoadEdge = {
  id: string;
  a: string;
  b: string;
  order: number;
  output: LadderOutput;
};

const labelOf = (definition: ComponentDefinition, terminalId: string): string =>
  definition.terminals.find((terminal) => terminal.id === terminalId)?.label ??
  terminalId;

const other = (edge: { a: string; b: string }, node: string): string =>
  edge.a === node ? edge.b : edge.a;

const reachable = (contacts: readonly ContactEdge[], start: string): Set<string> => {
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length > 0) {
    const node = stack.pop() as string;
    for (const edge of contacts) {
      if (edge.a !== node && edge.b !== node) continue;
      const next = other(edge, node);
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(next);
    }
  }
  return seen;
};

const componentEdges = (
  contacts: readonly ContactEdge[],
  start: string,
): ContactEdge[] => {
  const nodes = reachable(contacts, start);
  return contacts.filter((edge) => nodes.has(edge.a) && nodes.has(edge.b));
};

const edgeKey = (contact: LadderContact): string =>
  `${contact.componentId}:${contact.kind}:${contact.terminalLabels[0]}:${contact.terminalLabels[1]}`;

const visitExpr = (expr: LadderExpr, visit: (contact: LadderContact) => void) => {
  if (expr.kind === "contact") {
    visit(expr.contact);
    return;
  }
  for (const item of expr.items) visitExpr(item, visit);
};

/**
 * 出力ごとの段へ展開した結果で、同じ物理接点が複数回参照されているか。
 * 端子番号まで含めるので、同じリレーの別接点は別物として数える。
 */
export const hasRepeatedPhysicalContact = (diagram: LadderDiagram): boolean => {
  const counts = new Map<string, number>();
  for (const rung of diagram.rungs) {
    if (!rung.condition) continue;
    visitExpr(rung.condition, (contact) => {
      const key = edgeKey(contact);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
  }
  return [...counts.values()].some((count) => count > 1);
};

/** 式に含まれる物理接点のキー。 */
const keysOfExpr = (expr: LadderExpr | undefined): Set<string> => {
  const keys = new Set<string>();
  if (expr) visitExpr(expr, (contact) => keys.add(edgeKey(contact)));
  return keys;
};

/**
 * 0V 側の接点網を、出力の左へそのまま写す。
 * 直列・並列のどちらでも「接点そのもの」は複製しない。
 */
const appendExpr = (
  expr: LadderExpr,
  start: string,
  end: string,
  edgeByKey: ReadonlyMap<string, ContactEdge>,
  serial: { value: number },
  out: SharedLadderEdge[],
): boolean => {
  if (expr.kind === "contact") {
    const source = edgeByKey.get(edgeKey(expr.contact));
    if (!source) return false;
    out.push({
      id: source.id,
      kind: "contact",
      from: start,
      to: end,
      order: source.order,
      contact: source.contact,
    });
    return true;
  }

  if (expr.kind === "parallel") {
    return expr.items.every((item) =>
      appendExpr(item, start, end, edgeByKey, serial, out),
    );
  }

  let here = start;
  for (let index = 0; index < expr.items.length; index += 1) {
    const last = index === expr.items.length - 1;
    const next = last ? end : `ladder-shared:${serial.value++}`;
    if (!appendExpr(expr.items[index], here, next, edgeByKey, serial, out)) {
      return false;
    }
    here = next;
  }
  return true;
};

/**
 * 実体配線から、接点を一度だけ持つ共有ラダー網を作る。
 *
 * + 側の接点網は物理ネットをそのまま共有する。0V 側にだけ置かれた条件は、
 * その接点群を使う負荷が 1 個だけなら、一般的なラダーの読み方に合わせて
 * 「条件 → 出力 → 0V」の順へ移す。複数負荷で 0V 側の網を共有している場合は、
 * 無理に複製せず実配線の向きを保つ。
 */
export const buildSharedLadder = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
  expanded: LadderDiagram,
): SharedLadderNetwork | undefined => {
  const dsu = new UnionFind();

  for (const connection of document.connections) {
    dsu.union(terminalRefKey(connection.from), terminalRefKey(connection.to));
  }

  for (const instance of document.components) {
    const definition = definitions.get(instance.definitionId);
    if (!definition) continue;
    const electrical = definition.electrical;
    if (electrical.kind === "terminal") {
      for (const terminalId of electrical.terminals.slice(1)) {
        dsu.union(
          terminalKey(instance.id, electrical.terminals[0]),
          terminalKey(instance.id, terminalId),
        );
      }
    }
    if (electrical.kind === "power") {
      dsu.union(terminalKey(instance.id, electrical.positiveTerminal), PLUS_NODE);
      dsu.union(terminalKey(instance.id, electrical.zeroTerminal), ZERO_NODE);
    }
  }

  const contacts: ContactEdge[] = [];
  const loads: LoadEdge[] = [];

  for (const instance of document.components) {
    const definition = definitions.get(instance.definitionId);
    if (!definition) continue;
    const electrical = definition.electrical;
    const name = describeComponent(instance, definition);
    const node = (terminalId: string) =>
      dsu.find(terminalKey(instance.id, terminalId));

    if (electrical.kind === "switch") {
      const contact: LadderContact = {
        componentId: instance.id,
        label: name,
        kind: electrical.contactType === "NO" ? "no" : "nc",
        terminalLabels: [
          labelOf(definition, electrical.terminalA),
          labelOf(definition, electrical.terminalB),
        ],
        operatedBy: "hand",
        maintained: electrical.action === "maintained" || undefined,
      };
      contacts.push({
        id: `contact:${instance.id}:switch`,
        a: node(electrical.terminalA),
        b: node(electrical.terminalB),
        order: instance.position.y,
        contact,
      });
      continue;
    }

    if (electrical.kind === "relay") {
      const { relay, delay } = electrical;
      for (const relayContact of relay.contacts) {
        const branches: [string | undefined, "no" | "nc"][] = [
          [relayContact.noTerminal, "no"],
          [relayContact.ncTerminal, "nc"],
        ];
        for (const [terminalId, kind] of branches) {
          if (terminalId === undefined) continue;
          const contact: LadderContact = {
            componentId: instance.id,
            label: name,
            kind,
            terminalLabels: [
              labelOf(definition, relayContact.commonTerminal),
              labelOf(definition, terminalId),
            ],
            operatedBy: "coil",
            delay: delay?.mode,
          };
          contacts.push({
            id: `contact:${instance.id}:${relayContact.id}:${kind}`,
            a: node(relayContact.commonTerminal),
            b: node(terminalId),
            order: instance.position.y,
            contact,
          });
        }
      }
      if (relay.coil) {
        loads.push({
          id: `output:${instance.id}:coil`,
          a: node(relay.coil.positiveTerminal),
          b: node(relay.coil.negativeTerminal),
          order: instance.position.y,
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
      }
      continue;
    }

    if (electrical.kind === "lamp") {
      loads.push({
        id: `output:${instance.id}:lamp`,
        a: node(electrical.terminalA),
        b: node(electrical.terminalB),
        order: instance.position.y,
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
    }
  }

  if (loads.length === 0) return undefined;

  const plus = dsu.find(PLUS_NODE);
  const zero = dsu.find(ZERO_NODE);
  if (plus === zero) return undefined;

  const fromPlus = reachable(contacts, plus);
  const fromZero = reachable(contacts, zero);

  const orient = (load: LoadEdge): { input: string; output: string } | null => {
    if (fromPlus.has(load.a) && fromZero.has(load.b)) {
      return { input: load.a, output: load.b };
    }
    if (fromPlus.has(load.b) && fromZero.has(load.a)) {
      return { input: load.b, output: load.a };
    }
    if (load.a === plus && fromZero.has(load.b)) {
      return { input: load.a, output: load.b };
    }
    if (load.b === plus && fromZero.has(load.a)) {
      return { input: load.b, output: load.a };
    }
    if (fromPlus.has(load.a) && load.b === zero) {
      return { input: load.a, output: load.b };
    }
    if (fromPlus.has(load.b) && load.a === zero) {
      return { input: load.b, output: load.a };
    }
    return null;
  };

  const oriented = loads.map((load) => ({ load, ends: orient(load) }));
  if (oriented.some((entry) => entry.ends === null)) return undefined;

  const plusComponent = new Set(componentEdges(contacts, plus).map((edge) => edge.id));
  const zeroComponent = componentEdges(contacts, zero);
  const zeroIds = new Set(zeroComponent.map((edge) => edge.id));

  // + と 0V が接点だけで同じ成分に入る回路は、この並べ替えでは扱わない。
  if ([...plusComponent].some((id) => zeroIds.has(id))) {
    return rawNetwork(contacts, loads, plus, zero);
  }

  const edgeByKey = new Map(contacts.map((edge) => [edgeKey(edge.contact), edge]));

  // expanded の各出力と load を componentId で対応させる。
  const rungOf = new Map(expanded.rungs.map((rung) => [rung.output.componentId, rung]));

  // 0V 側の同一接点を複数負荷が使うなら、移動すると複製が必要になる。
  const rightUse = new Map<string, number>();
  for (const { load, ends } of oriented) {
    if (!ends || ends.output === zero) continue;
    const rung = rungOf.get(load.output.componentId);
    for (const key of keysOfExpr(rung?.movedFromZeroSide ? rung.condition : undefined)) {
      const source = edgeByKey.get(key);
      if (source && zeroIds.has(source.id)) {
        rightUse.set(source.id, (rightUse.get(source.id) ?? 0) + 1);
      }
    }
  }
  if ([...rightUse.values()].some((count) => count > 1)) {
    return rawNetwork(contacts, loads, plus, zero);
  }

  const out: SharedLadderEdge[] = [];

  // + 側の物理接点網は一切展開せず、そのまま 1 回ずつ置く。
  for (const edge of contacts) {
    if (!plusComponent.has(edge.id)) continue;
    out.push({
      id: edge.id,
      kind: "contact",
      from: edge.a,
      to: edge.b,
      order: edge.order,
      contact: edge.contact,
    });
  }

  let movedZeroSide = false;
  const serial = { value: 0 };

  for (const { load, ends } of oriented) {
    if (!ends) continue;
    const rung = rungOf.get(load.output.componentId);

    if (ends.output === zero || !rung?.movedFromZeroSide || !rung.condition) {
      out.push({
        id: load.id,
        kind: "output",
        from: ends.input,
        to: ends.output,
        order: load.order,
        output: load.output,
      });
      continue;
    }

    /*
     * rung.condition は + 側と 0V 側を直列に連結した式なので、そのまま使うと
     * + 側の接点をもう一度描いてしまう。0V 成分に属する葉だけを抽出して、
     * 元の 0V 側ネットそのものを移す。
     */
    const rightEdges = zeroComponent.filter((edge) => {
      const used = keysOfExpr(rung.condition).has(edgeKey(edge.contact));
      return used;
    });

    if (rightEdges.length === 0) {
      out.push({
        id: load.id,
        kind: "output",
        from: ends.input,
        to: ends.output,
        order: load.order,
        output: load.output,
      });
      continue;
    }

    // 0V 側成分を start=input, end=beforeOutput へ写像する。
    const beforeOutput = `ladder-shared:before-output:${load.id}`;
    const mapNode = (node: string): string => {
      if (node === ends.output) return ends.input;
      if (node === zero) return beforeOutput;
      return `ladder-shared:${load.id}:${node}`;
    };

    for (const edge of rightEdges) {
      out.push({
        id: edge.id,
        kind: "contact",
        from: mapNode(edge.a),
        to: mapNode(edge.b),
        order: edge.order,
        contact: edge.contact,
      });
    }
    out.push({
      id: load.id,
      kind: "output",
      from: beforeOutput,
      to: zero,
      order: load.order,
      output: load.output,
    });
    movedZeroSide = true;
  }

  // 同じ物理接点が 2 回入っていたら共有図として失格。安全側へ倒す。
  const contactIds = out.filter((edge) => edge.kind === "contact").map((edge) => edge.id);
  if (new Set(contactIds).size !== contactIds.length) {
    return rawNetwork(contacts, loads, plus, zero);
  }

  return {
    plus,
    zero,
    edges: out,
    movedZeroSide,
    wiringFaithfulFallback: false,
  };
};

const rawNetwork = (
  contacts: readonly ContactEdge[],
  loads: readonly LoadEdge[],
  plus: string,
  zero: string,
): SharedLadderNetwork => ({
  plus,
  zero,
  edges: [
    ...contacts.map<SharedLadderEdge>((edge) => ({
      id: edge.id,
      kind: "contact",
      from: edge.a,
      to: edge.b,
      order: edge.order,
      contact: edge.contact,
    })),
    ...loads.map<SharedLadderEdge>((load) => ({
      id: load.id,
      kind: "output",
      from: load.a,
      to: load.b,
      order: load.order,
      output: load.output,
    })),
  ],
  movedZeroSide: false,
  wiringFaithfulFallback: true,
});
