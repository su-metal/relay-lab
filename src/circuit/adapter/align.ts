/**
 * 選択した部品を揃える（design.md §8.13）。
 *
 * 自動整理とは役割を分け、ユーザーが選んだ部品だけを指定した基準へ揃える。
 */

import type {
  CircuitDocument,
  ComponentDefinitionRegistry,
} from "@/circuit/types";
import { componentSizeOf } from "@/circuit/types";

import type { Point } from "./selection";

export type AlignMode =
  | "left"
  | "center-x"
  | "right"
  | "top"
  | "center-y"
  | "bottom"
  | "distribute-x"
  | "distribute-y";

export const isDistributeMode = (mode: AlignMode): boolean =>
  mode === "distribute-x" || mode === "distribute-y";

export const minimumSelection = (mode: AlignMode): number =>
  isDistributeMode(mode) ? 3 : 2;

type Span = { id: string; start: number; size: number; origin: Point };

const centerOf = (span: Span): number => span.start + span.size / 2;

const alignedStarts = (spans: readonly Span[], mode: AlignMode): number[] => {
  const minStart = Math.min(...spans.map((span) => span.start));
  const maxEnd = Math.max(...spans.map((span) => span.start + span.size));

  switch (mode) {
    case "left":
    case "top":
      return spans.map(() => minStart);

    case "right":
    case "bottom":
      return spans.map((span) => maxEnd - span.size);

    case "center-x":
    case "center-y": {
      const center = (minStart + maxEnd) / 2;
      return spans.map((span) => Math.round(center - span.size / 2));
    }

    case "distribute-x":
    case "distribute-y": {
      const ordered = [...spans].sort(
        (a, b) =>
          centerOf(a) - centerOf(b) ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
      const first = centerOf(ordered[0]);
      const last = centerOf(ordered[ordered.length - 1]);
      const step = (last - first) / (ordered.length - 1);

      const byId = new Map<string, number>();
      ordered.forEach((span, index) => {
        const center = first + step * index;
        byId.set(span.id, Math.round(center - span.size / 2));
      });
      return spans.map((span) => byId.get(span.id) as number);
    }
  }
};

const isHorizontal = (mode: AlignMode): boolean =>
  mode === "left" ||
  mode === "center-x" ||
  mode === "right" ||
  mode === "distribute-x";

export const alignComponents = (
  document: CircuitDocument,
  registry: ComponentDefinitionRegistry,
  targetIds: readonly string[],
  mode: AlignMode,
): Map<string, Point> => {
  const scope = new Set(targetIds);
  const horizontal = isHorizontal(mode);

  const spans: Span[] = [];
  for (const instance of document.components) {
    if (!scope.has(instance.id)) continue;
    const definition = registry.get(instance.definitionId);
    if (!definition) continue;
    const size = componentSizeOf(instance, definition);
    spans.push({
      id: instance.id,
      start: horizontal ? instance.position.x : instance.position.y,
      size: horizontal ? size.width : size.height,
      origin: instance.position,
    });
  }

  if (spans.length < minimumSelection(mode)) return new Map();

  const starts = alignedStarts(spans, mode);

  const moved = new Map<string, Point>();
  spans.forEach((span, index) => {
    const start = starts[index];
    if (start === span.start) return;
    moved.set(
      span.id,
      horizontal
        ? { x: start, y: span.origin.y }
        : { x: span.origin.x, y: start },
    );
  });
  return moved;
};
