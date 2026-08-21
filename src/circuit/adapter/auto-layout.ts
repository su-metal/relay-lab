/**
 * 配置の自動整理（design.md §8.9）。
 *
 * 描いた並びを保ったまま、グリッド吸着・近い行列の整列・重なり解消だけを行う。
 */

import type {
  CircuitDocument,
  ComponentDefinitionRegistry,
} from "@/circuit/types";
import { componentSizeOf } from "@/circuit/types";

import type { Point } from "./selection";

export const LAYOUT_GRID = 16;
export const ALIGN_TOLERANCE = LAYOUT_GRID * 2;
export const LAYOUT_GAP = LAYOUT_GRID * 2;

type Rect = { x: number; y: number; width: number; height: number };

const snap = (value: number): number =>
  Math.round(value / LAYOUT_GRID) * LAYOUT_GRID;

const snapDown = (value: number): number =>
  Math.ceil(value / LAYOUT_GRID) * LAYOUT_GRID;

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

const alignedValues = (values: readonly number[]): number[] => {
  const order = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => a.value - b.value);

  const result = new Array<number>(values.length);
  let start = 0;
  while (start < order.length) {
    const anchor = order[start].value;
    let end = start + 1;
    let sum = anchor;
    while (end < order.length && order[end].value - anchor <= ALIGN_TOLERANCE) {
      sum += order[end].value;
      end += 1;
    }
    const aligned = snap(sum / (end - start));
    for (let index = start; index < end; index += 1) {
      result[order[index].index] = aligned;
    }
    start = end;
  }
  return result;
};

export const arrangeComponents = (
  document: CircuitDocument,
  registry: ComponentDefinitionRegistry,
  targetIds?: readonly string[],
): Map<string, Point> => {
  const scope = targetIds ? new Set(targetIds) : null;
  const fixed: Rect[] = [];
  const targets: { id: string; origin: Point; rect: Rect }[] = [];

  for (const instance of document.components) {
    const definition = registry.get(instance.definitionId);
    if (!definition) continue;
    const size = componentSizeOf(instance, definition);
    const rect: Rect = {
      x: instance.position.x,
      y: instance.position.y,
      width: size.width,
      height: size.height,
    };
    if (scope && !scope.has(instance.id)) {
      fixed.push(rect);
    } else {
      targets.push({ id: instance.id, origin: instance.position, rect });
    }
  }

  if (targets.length === 0) return new Map();

  const xs = alignedValues(targets.map((target) => target.rect.x));
  const ys = alignedValues(targets.map((target) => target.rect.y));
  targets.forEach((target, index) => {
    target.rect.x = xs[index];
    target.rect.y = ys[index];
  });

  const placed: Rect[] = [...fixed];
  const ordered = [...targets].sort(
    (a, b) =>
      a.rect.y - b.rect.y ||
      a.rect.x - b.rect.x ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  for (const target of ordered) {
    const limit = placed.length;
    for (let guard = 0; guard <= limit; guard += 1) {
      const blocker = placed.find((rect) => overlaps(target.rect, rect));
      if (!blocker) break;
      target.rect.y = snapDown(blocker.y + blocker.height + LAYOUT_GAP);
    }
    placed.push(target.rect);
  }

  const moved = new Map<string, Point>();
  for (const target of targets) {
    if (
      target.rect.x !== target.origin.x ||
      target.rect.y !== target.origin.y
    ) {
      moved.set(target.id, { x: target.rect.x, y: target.rect.y });
    }
  }
  return moved;
};
