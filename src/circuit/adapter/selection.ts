/**
 * 範囲選択（ラバーバンド）の当たり判定（design.md §8.6）。
 *
 * React Flow は配線そのものを枠で選べないため、枠と配線の交差はこちらで判定する。
 */

import type {
  CircuitDocument,
  ComponentDefinition,
  ComponentDefinitionRegistry,
} from "@/circuit/types";
import { componentSizeOf } from "@/circuit/types";

import { layoutTerminals } from "./reactflow";

export type Point = { x: number; y: number };

export type SelectionRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** 端子 1 個のキャンバス座標。リサイズ後の実寸法で相対座標を展開する。 */
export const terminalPoint = (
  instance: CircuitDocument["components"][number],
  definition: ComponentDefinition,
  terminalId: string,
): Point | null => {
  const terminals = layoutTerminals(definition, instance.flipped === true);
  const terminal = terminals.find((current) => current.id === terminalId);
  if (!terminal) return null;
  const size = componentSizeOf(instance, definition);
  return {
    x: instance.position.x + terminal.position.x * size.width,
    y: instance.position.y + terminal.position.y * size.height,
  };
};

const isInside = (point: Point, rect: SelectionRect): boolean =>
  point.x >= rect.x &&
  point.x <= rect.x + rect.width &&
  point.y >= rect.y &&
  point.y <= rect.y + rect.height;

const cross = (a: Point, b: Point, c: Point): number =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

const sign = (value: number): number =>
  value > 0 ? 1 : value < 0 ? -1 : 0;

const segmentsCross = (a: Point, b: Point, c: Point, d: Point): boolean => {
  const d1 = sign(cross(a, b, c));
  const d2 = sign(cross(a, b, d));
  const d3 = sign(cross(c, d, a));
  const d4 = sign(cross(c, d, b));
  return d1 !== d2 && d3 !== d4;
};

export const segmentTouchesRect = (
  a: Point,
  b: Point,
  rect: SelectionRect,
): boolean => {
  if (isInside(a, rect) || isInside(b, rect)) return true;

  const topLeft = { x: rect.x, y: rect.y };
  const topRight = { x: rect.x + rect.width, y: rect.y };
  const bottomRight = { x: rect.x + rect.width, y: rect.y + rect.height };
  const bottomLeft = { x: rect.x, y: rect.y + rect.height };

  return (
    segmentsCross(a, b, topLeft, topRight) ||
    segmentsCross(a, b, topRight, bottomRight) ||
    segmentsCross(a, b, bottomRight, bottomLeft) ||
    segmentsCross(a, b, bottomLeft, topLeft)
  );
};

export const componentsInRect = (
  document: CircuitDocument,
  registry: ComponentDefinitionRegistry,
  rect: SelectionRect,
): string[] => {
  if (rect.width <= 0 || rect.height <= 0) return [];

  const matched: string[] = [];
  for (const instance of document.components) {
    const definition = registry.get(instance.definitionId);
    if (!definition) continue;
    const { x, y } = instance.position;
    const { width, height } = componentSizeOf(instance, definition);
    if (
      x >= rect.x &&
      y >= rect.y &&
      x + width <= rect.x + rect.width &&
      y + height <= rect.y + rect.height
    ) {
      matched.push(instance.id);
    }
  }
  return matched;
};

export const connectionsInRect = (
  document: CircuitDocument,
  registry: ComponentDefinitionRegistry,
  rect: SelectionRect,
): string[] => {
  if (rect.width <= 0 || rect.height <= 0) return [];

  const instances = new Map(
    document.components.map((component) => [component.id, component]),
  );

  const pointOf = (ref: { componentId: string; terminalId: string }) => {
    const instance = instances.get(ref.componentId);
    if (!instance) return null;
    const definition = registry.get(instance.definitionId);
    if (!definition) return null;
    return terminalPoint(instance, definition, ref.terminalId);
  };

  const matched: string[] = [];
  for (const connection of document.connections) {
    const from = pointOf(connection.from);
    const to = pointOf(connection.to);
    if (!from || !to) continue;
    if (segmentTouchesRect(from, to, rect)) matched.push(connection.id);
  }
  return matched;
};

export const connectionsOfComponents = (
  document: CircuitDocument,
  componentIds: readonly string[],
): string[] => {
  const targets = new Set(componentIds);
  return document.connections
    .filter(
      (connection) =>
        targets.has(connection.from.componentId) ||
        targets.has(connection.to.componentId),
    )
    .map((connection) => connection.id);
};
