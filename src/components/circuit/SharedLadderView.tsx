import { useMemo } from "react";

import type {
  SharedLadderEdge,
  SharedLadderNetwork,
} from "@/circuit/adapter/ladder-shared";

import styles from "./SharedLadderView.module.css";

type Point = { x: number; y: number };
type PlacedEdge = { edge: SharedLadderEdge; path: string; symbol: Point };

type Layout = {
  width: number;
  height: number;
  plusX: number;
  zeroX: number;
  placed: PlacedEdge[];
};

const compareEdge = (a: SharedLadderEdge, b: SharedLadderEdge) =>
  a.order - b.order || a.id.localeCompare(b.id);

const otherEnd = (edge: SharedLadderEdge, node: string) =>
  edge.from === node ? edge.to : edge.from;

const layoutNetwork = (network: SharedLadderNetwork): Layout => {
  const contacts = network.edges.filter((edge) => edge.kind === "contact");
  const outputs = network.edges
    .filter((edge) => edge.kind === "output")
    .sort(compareEdge);

  const adjacency = new Map<string, SharedLadderEdge[]>();
  for (const edge of contacts) {
    for (const node of [edge.from, edge.to]) {
      const list = adjacency.get(node);
      if (list) list.push(edge);
      else adjacency.set(node, [edge]);
    }
  }
  for (const list of adjacency.values()) list.sort(compareEdge);

  const parent = new Map<string, { node: string; edge: SharedLadderEdge }>();
  const depth = new Map<string, number>([[network.plus, 0]]);
  const queue = [network.plus];
  const treeEdgeIds = new Set<string>();

  while (queue.length > 0) {
    const node = queue.shift() as string;
    const d = depth.get(node) ?? 0;
    for (const edge of adjacency.get(node) ?? []) {
      const next = otherEnd(edge, node);
      if (next === network.zero || depth.has(next)) continue;
      depth.set(next, d + 1);
      parent.set(next, { node, edge });
      treeEdgeIds.add(edge.id);
      queue.push(next);
    }
  }

  let maxDepth = Math.max(0, ...depth.values());
  for (const edge of contacts) {
    for (const node of [edge.from, edge.to]) {
      if (node === network.zero || depth.has(node)) continue;
      maxDepth += 1;
      depth.set(node, maxDepth);
    }
  }

  const outputRowGap = 104;
  const rowOfOutput = new Map<string, number>();
  outputs.forEach((edge, index) => rowOfOutput.set(edge.id, 82 + index * outputRowGap));

  const outputRowsAt = new Map<string, number[]>();
  for (const output of outputs) {
    const row = rowOfOutput.get(output.id) as number;
    const node = output.to === network.zero ? output.from : output.to;
    const list = outputRowsAt.get(node);
    if (list) list.push(row);
    else outputRowsAt.set(node, [row]);
  }

  const children = new Map<string, string[]>();
  for (const [child, info] of parent) {
    const list = children.get(info.node);
    if (list) list.push(child);
    else children.set(info.node, [child]);
  }

  const rawY = new Map<string, number>();
  const computeRawY = (node: string, visiting = new Set<string>()): number => {
    const cached = rawY.get(node);
    if (cached !== undefined) return cached;
    if (visiting.has(node)) return 82;
    visiting.add(node);

    const rows = [...(outputRowsAt.get(node) ?? [])];
    for (const child of children.get(node) ?? []) rows.push(computeRawY(child, visiting));

    if (rows.length === 0) {
      const incident = adjacency.get(node) ?? [];
      const orders = incident.map((edge) => edge.order).filter(Number.isFinite);
      const rank =
        orders.length === 0
          ? 0
          : Math.max(0, orders.reduce((a, b) => a + b, 0) / orders.length);
      rows.push(82 + (rank % 4) * 24);
    }

    const y = rows.reduce((a, b) => a + b, 0) / rows.length;
    visiting.delete(node);
    rawY.set(node, y);
    return y;
  };

  computeRawY(network.plus);
  for (const node of depth.keys()) computeRawY(node);

  // 同じ列の接点ラベルがぶつからないよう、節点の縦間隔を確保する。
  const displayY = new Map(rawY);
  const minNodeGap = 64;
  const nodesByDepth = new Map<number, string[]>();
  for (const [node, d] of depth) {
    if (node === network.plus || node === network.zero) continue;
    const list = nodesByDepth.get(d);
    if (list) list.push(node);
    else nodesByDepth.set(d, [node]);
  }
  for (const nodes of nodesByDepth.values()) {
    nodes.sort((a, b) => (rawY.get(a) ?? 0) - (rawY.get(b) ?? 0));
    let previous = -Infinity;
    for (const node of nodes) {
      const desired = rawY.get(node) ?? 82;
      const y = Math.max(desired, previous + minNodeGap);
      displayY.set(node, y);
      previous = y;
    }
  }

  const plusX = 34;
  const stepX = 170;
  const nodeX = (node: string) => plusX + (depth.get(node) ?? 0) * stepX;
  const nodeY = (node: string) => displayY.get(node) ?? computeRawY(node);
  const zeroX = plusX + (maxDepth + 2) * stepX;

  const placed: PlacedEdge[] = [];

  for (const edge of contacts) {
    const a = edge.from;
    const b = edge.to;
    const ax = nodeX(a);
    const ay = nodeY(a);
    const bx = nodeX(b);
    const by = nodeY(b);

    if (treeEdgeIds.has(edge.id)) {
      const child = parent.has(b) && parent.get(b)?.edge.id === edge.id ? b : a;
      const info = parent.get(child);
      const p = info?.node ?? (child === a ? b : a);
      const px = nodeX(p);
      const py = nodeY(p);
      const cx = nodeX(child);
      const cy = nodeY(child);
      placed.push({
        edge,
        path: `M ${px} ${py} V ${cy} H ${cx}`,
        symbol: { x: (px + cx) / 2, y: cy },
      });
      continue;
    }

    const bridgeY = Math.max(50, (ay + by) / 2 - 34);
    placed.push({
      edge,
      path: `M ${ax} ${ay} V ${bridgeY} H ${bx} V ${by}`,
      symbol: { x: (ax + bx) / 2, y: bridgeY },
    });
  }

  for (const edge of outputs) {
    const row = rowOfOutput.get(edge.id) as number;
    const from = edge.to === network.zero ? edge.from : edge.to;
    const fx = nodeX(from);
    const fy = nodeY(from);
    placed.push({
      edge,
      path: `M ${fx} ${fy} V ${row} H ${zeroX}`,
      symbol: { x: zeroX - 66, y: row },
    });
  }

  const bottom = Math.max(
    0,
    ...placed.map(({ symbol }) => symbol.y),
    ...[...displayY.values()],
  );
  const height = Math.max(190, bottom + 72, 128 + outputs.length * outputRowGap);
  const width = Math.max(820, zeroX + 34);

  return { width, height, plusX, zeroX, placed };
};

const labelWidth = (text: string): number =>
  Math.max(
    54,
    Array.from(text).reduce(
      (sum, char) => sum + (char.charCodeAt(0) > 255 ? 11 : 7),
      0,
    ) + 12,
  );

export function SharedLadderView({ network }: { network: SharedLadderNetwork }) {
  const layout = useMemo(() => layoutNetwork(network), [network]);

  return (
    <div className={styles.scroll}>
      <svg
        className={styles.diagram}
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="img"
        aria-label="同じ実接点を一度だけ描いた共有配線ラダー図"
      >
        <line className={styles.rail} x1={layout.plusX} y1="24" x2={layout.plusX} y2={layout.height - 24} />
        <line className={styles.rail} x1={layout.zeroX} y1="24" x2={layout.zeroX} y2={layout.height - 24} />
        <text className={styles.railLabel} x={layout.plusX + 6} y="18">+24V</text>
        <text className={styles.railLabel} x={layout.zeroX - 6} y="18" textAnchor="end">0V</text>

        {layout.placed.map(({ edge, path }) => (
          <path key={`wire:${edge.id}`} className={styles.wire} d={path} />
        ))}

        {layout.placed.map(({ edge, symbol }) =>
          edge.kind === "contact" ? (
            <ContactSymbol key={edge.id} edge={edge} point={symbol} />
          ) : (
            <OutputSymbol key={edge.id} edge={edge} point={symbol} />
          ),
        )}
      </svg>
    </div>
  );
}

function ContactSymbol({
  edge,
  point,
}: {
  edge: Extract<SharedLadderEdge, { kind: "contact" }>;
  point: Point;
}) {
  const { contact } = edge;
  const width = labelWidth(contact.label);
  return (
    <g transform={`translate(${point.x - 28} ${point.y - 12})`}>
      <rect className={styles.mask} x="6" y="-5" width="44" height="34" rx="2" />
      <rect className={styles.textMask} x={28 - width / 2} y="-20" width={width} height="15" rx="2" />
      <rect className={styles.textMask} x="8" y="29" width="40" height="14" rx="2" />
      <line className={styles.symbol} x1="0" y1="12" x2="15" y2="12" />
      <line className={styles.symbol} x1="15" y1="4" x2="15" y2="20" />
      <line className={styles.symbol} x1="41" y1="4" x2="41" y2="20" />
      <line className={styles.symbol} x1="41" y1="12" x2="56" y2="12" />
      {contact.kind === "nc" && <line className={styles.symbol} x1="12" y1="21" x2="44" y2="3" />}
      <text className={styles.label} x="28" y="-8" textAnchor="middle">{contact.label}</text>
      <text className={styles.terminals} x="28" y="39" textAnchor="middle">
        {contact.terminalLabels[0]}-{contact.terminalLabels[1]}
      </text>
    </g>
  );
}

function OutputSymbol({
  edge,
  point,
}: {
  edge: Extract<SharedLadderEdge, { kind: "output" }>;
  point: Point;
}) {
  const { output } = edge;
  const width = labelWidth(output.label);
  return (
    <g transform={`translate(${point.x - 28} ${point.y - 12})`}>
      <rect className={styles.mask} x="6" y="-5" width="44" height="34" rx="2" />
      <rect className={styles.textMask} x={28 - width / 2} y="-20" width={width} height="15" rx="2" />
      <rect className={styles.textMask} x="8" y="29" width="40" height="14" rx="2" />
      <line className={styles.symbol} x1="0" y1="12" x2="15" y2="12" />
      <line className={styles.symbol} x1="41" y1="12" x2="56" y2="12" />
      {output.kind === "coil" ? (
        <>
          <path className={styles.symbol} d="M19 4 A 9 9 0 0 0 19 20" />
          <path className={styles.symbol} d="M37 4 A 9 9 0 0 1 37 20" />
        </>
      ) : (
        <>
          <circle className={styles.symbol} cx="28" cy="12" r="9" />
          <line className={styles.symbol} x1="21.5" y1="5.5" x2="34.5" y2="18.5" />
          <line className={styles.symbol} x1="34.5" y1="5.5" x2="21.5" y2="18.5" />
        </>
      )}
      <text className={styles.label} x="28" y="-8" textAnchor="middle">{output.label}</text>
      <text className={styles.terminals} x="28" y="39" textAnchor="middle">
        {output.terminalLabels[0]}-{output.terminalLabels[1]}
      </text>
    </g>
  );
}
