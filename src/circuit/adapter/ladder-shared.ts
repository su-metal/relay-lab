/**
 * 同じ実接点を 1 回だけ描くための共有ラダー表現。
 *
 * `ladder.ts` の「1 出力 = 1 段」は単純な回路では読みやすいが、1 枚の実接点の
 * 先から複数負荷へ分岐する回路では、同じ端子対を複数段へ展開してしまう。
 * ここでは電線で同電位になった節点と実接点を共有したまま持ち、図記号を複製しない。
 */

import { UnionFind, describeComponent } from "@/circuit/engine";
import type {
  CircuitDocument,
  ComponentDefinition,
  ComponentDefinitionRegistry,
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
  movedZeroSide: boolean;
  /** 安全に標準形へ移せず実配線の向きを残した場合。UI は従来表示へ戻す。 */
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

const physicalKey = (contact: LadderContact): string =>
  `${contact.componentId}:${contact.kind}:${contact.terminalLabels[0]}:${contact.terminalLabels[1]}`;

const visitExpr = (expr: LadderExpr, visit: (contact: LadderContact) => void) => {
  if (expr.kind === "contact") {
    visit(expr.contact);
    return;
  }
  for (const item of expr.items) visitExpr(item, visit);
};

const keysOfDiagram = (diagram: LadderDiagram): Set<string> => {
  const keys = new Set<string>();
  for (const rung of diagram.rungs) {
    if (rung.condition) visitExpr(rung.condition, (contact) => keys.add(physicalKey(contact)));
  }
  return keys;
};

const keysOfRung = (diagram: LadderDiagram, componentId: string): Set<string> => {
  const keys = new Set<string>();
  const rung = diagram.rungs.find((entry) => entry.output.componentId === componentId);
  if (rung?.condition) visitExpr(rung.condition, (contact) => keys.add(physicalKey(contact)));
  return keys;
};

/** 出力ごとの展開で同じ物理接点が複数回参照されたか。 */
export const hasRepeatedPhysicalContact = (diagram: LadderDiagram): boolean => {
  const counts = new Map<string, number>();
  for (const rung of diagram.rungs) {
    if (!rung.condition) continue;
    visitExpr(rung.condition, (contact) => {
      const key = physicalKey(contact);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
  }
  return [...counts.values()].some((count) => count > 1);
};

const other = (edge: ContactEdge, node: string): string =>
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

const componentEdges = (contacts: readonly ContactEdge[], start: string): ContactEdge[] => {
  const nodes = reachable(contacts, start);
  return contacts.filter((edge) => nodes.has(edge.a) && nodes.has(edge.b));
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

/**
 * + 側の接点網は共有したまま残す。0V 側にだけある条件は、その接点群を使う負荷が
 * 1 個なら出力の左へ移す。これで「共通接点 → 分岐 → 各出力」という現場で読む形に
 * しつつ、同じ実接点は 1 回しか現れない。
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
    const node = (terminalId: string) => dsu.find(terminalKey(instance.id, terminalId));

    if (electrical.kind === "switch") {
      contacts.push({
        id: `contact:${instance.id}:switch`,
        a: node(electrical.terminalA),
        b: node(electrical.terminalB),
        order: instance.position.y,
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
          contacts.push({
            id: `contact:${instance.id}:${relayContact.id}:${kind}`,
            a: node(relayContact.commonTerminal),
            b: node(terminalId),
            order: instance.position.y,
            contact: {
              componentId: instance.id,
              label: name,
              kind,
              terminalLabels: [
                labelOf(definition, relayContact.commonTerminal),
                labelOf(definition, terminalId),
              ],
              operatedBy: "coil",
              delay: delay?.mode,
            },
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
  const usedKeys = keysOfDiagram(expanded);

  const orient = (load: LoadEdge): { input: string; output: string } | null => {
    if ((load.a === plus || fromPlus.has(load.a)) && (load.b === zero || fromZero.has(load.b))) {
      return { input: load.a, output: load.b };
    }
    if ((load.b === plus || fromPlus.has(load.b)) && (load.a === zero || fromZero.has(load.a))) {
      return { input: load.b, output: load.a };
    }
    return null;
  };

  const oriented = loads.map((load) => ({ load, ends: orient(load) }));
  if (oriented.some((entry) => entry.ends === null)) return undefined;

  const plusComponent = new Set(componentEdges(contacts, plus).map((edge) => edge.id));
  const zeroComponent = componentEdges(contacts, zero);
  const zeroIds = new Set(zeroComponent.map((edge) => edge.id));

  // 接点だけで + と 0V が同じ成分になる場合は、位置を移すと意味を壊す可能性がある。
  if ([...plusComponent].some((id) => zeroIds.has(id))) {
    return rawNetwork(contacts, loads, plus, zero);
  }

  const contactByKey = new Map(contacts.map((edge) => [physicalKey(edge.contact), edge]));

  // 0V 側の同一接点を複数負荷が使う場合、左へ移すと接点を複製する必要がある。
  const rightUse = new Map<string, number>();
  for (const { load, ends } of oriented) {
    if (!ends || ends.output === zero) continue;
    for (const key of keysOfRung(expanded, load.output.componentId)) {
      const edge = contactByKey.get(key);
      if (edge && zeroIds.has(edge.id)) {
        rightUse.set(edge.id, (rightUse.get(edge.id) ?? 0) + 1);
      }
    }
  }
  if ([...rightUse.values()].some((count) => count > 1)) {
    return rawNetwork(contacts, loads, plus, zero);
  }

  const result: SharedLadderEdge[] = [];

  // 実際にいずれかの段で使われた + 側接点だけを、物理ネット上に 1 回置く。
  for (const edge of contacts) {
    if (!plusComponent.has(edge.id) || !usedKeys.has(physicalKey(edge.contact))) continue;
    result.push({
      id: edge.id,
      kind: "contact",
      from: edge.a,
      to: edge.b,
      order: edge.order,
      contact: edge.contact,
    });
  }

  let movedZeroSide = false;

  for (const { load, ends } of oriented) {
    if (!ends) continue;
    const rung = expanded.rungs.find((entry) => entry.output.componentId === load.output.componentId);
    const rungKeys = keysOfRung(expanded, load.output.componentId);
    const rightEdges = zeroComponent.filter(
      (edge) => rungKeys.has(physicalKey(edge.contact)) && usedKeys.has(physicalKey(edge.contact)),
    );

    if (ends.output === zero || !rung?.movedFromZeroSide || rightEdges.length === 0) {
      result.push({
        id: load.id,
        kind: "output",
        from: ends.input,
        to: ends.output,
        order: load.order,
        output: load.output,
      });
      continue;
    }

    // 0V 側の成分を input の先へ写し、最後に出力を置く。
    const beforeOutput = `ladder-shared:before-output:${load.id}`;
    const mapNode = (node: string): string => {
      if (node === ends.output) return ends.input;
      if (node === zero) return beforeOutput;
      return `ladder-shared:${load.id}:${node}`;
    };

    for (const edge of rightEdges) {
      result.push({
        id: edge.id,
        kind: "contact",
        from: mapNode(edge.a),
        to: mapNode(edge.b),
        order: edge.order,
        contact: edge.contact,
      });
    }
    result.push({
      id: load.id,
      kind: "output",
      from: beforeOutput,
      to: zero,
      order: load.order,
      output: load.output,
    });
    movedZeroSide = true;
  }

  const contactIds = result.filter((edge) => edge.kind === "contact").map((edge) => edge.id);
  if (new Set(contactIds).size !== contactIds.length) {
    return rawNetwork(contacts, loads, plus, zero);
  }

  return {
    plus,
    zero,
    edges: result,
    movedZeroSide,
    wiringFaithfulFallback: false,
  };
};
