/**
 * 範囲選択（ラバーバンド）の当たり判定（design.md §8.6）。
 *
 * **React Flow は配線そのものを枠で選べない。** React Flow の範囲選択は
 * 「枠に入ったノード」と「そのノードに繋がる Edge」しか選ばない
 * （`container/Pane` の `commitUserSelectionRect`）。電源とリレーを結ぶ長い 1 本を
 * 途中で囲んで消す、という図面の直しがこれでは成立しない。
 *
 * そこで **枠と配線の交差はこちらで判定する。** ここは `@xyflow/react` を
 * 一切 import しない純粋関数で、React Flow から渡ってくる矩形は
 * UI 層（`useWireRangeSelection`）がキャンバス座標へ直してから渡す。
 *
 * **配線は両端子を結ぶ線分として扱う。** 実際の描画は角の丸い折れ線で、さらに
 * 重なりを解くために幹線がずれている（§8.7）ため、見た目の線と判定線は厳密には
 * 一致しない（design.md §6）。両端の座標だけで決まる判定にしておくことで、
 * 描画の都合（曲率・レーンのずらし量）に引きずられず、DOM を測らずに Vitest で検証できる。
 */

import type {
  CircuitDocument,
  ComponentDefinition,
  ComponentDefinitionRegistry,
} from "@/circuit/types";

import { layoutTerminals } from "./reactflow";

export type Point = { x: number; y: number };

/** キャンバス座標系の矩形（左上と大きさ） */
export type SelectionRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * 端子 1 個のキャンバス座標。
 *
 * `TerminalDefinition.position` は部品内の相対座標（左上 0,0 / 右下 1,1）なので、
 * 部品の位置と `visual` の寸法で実座標へ戻す。**左右反転を必ず通すこと。**
 * 反転した部品は端子が鏡像の位置に描かれており、定義の座標をそのまま使うと
 * 判定線が実際の配線と左右逆になる。
 */
export const terminalPoint = (
  instance: CircuitDocument["components"][number],
  definition: ComponentDefinition,
  terminalId: string,
): Point | null => {
  const terminals = layoutTerminals(definition, instance.flipped === true);
  const terminal = terminals.find((current) => current.id === terminalId);
  if (!terminal) return null;
  return {
    x: instance.position.x + terminal.position.x * definition.visual.width,
    y: instance.position.y + terminal.position.y * definition.visual.height,
  };
};

const isInside = (point: Point, rect: SelectionRect): boolean =>
  point.x >= rect.x &&
  point.x <= rect.x + rect.width &&
  point.y >= rect.y &&
  point.y <= rect.y + rect.height;

/** 3 点の回転方向。0 なら一直線上 */
const cross = (a: Point, b: Point, c: Point): number =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

const sign = (value: number): number =>
  value > 0 ? 1 : value < 0 ? -1 : 0;

/**
 * 線分どうしの交差。共線（両方 0）は端点の内包で拾えるのでここでは扱わない。
 * 矩形の 4 辺との判定にしか使わないため、これで足りる。
 */
const segmentsCross = (a: Point, b: Point, c: Point, d: Point): boolean => {
  const d1 = sign(cross(a, b, c));
  const d2 = sign(cross(a, b, d));
  const d3 = sign(cross(c, d, a));
  const d4 = sign(cross(c, d, b));
  return d1 !== d2 && d3 !== d4;
};

/**
 * 線分が矩形に **触れている**か（内包ではなく交差）。
 *
 * 配線には面積が無いので「完全に枠へ入れる」判定にすると、部品から部品へ渡る
 * 長い線はほぼ選べなくなる。**部品は枠に収まったものだけ・配線は枠に触れたもの**
 * という非対称をここで引き受けている（design.md §8.6）。
 */
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

/**
 * 矩形に **すっぽり収まっている**部品の ID。
 *
 * 部品は面積を持つので「枠に入れたものだけ」（React Flow の `SelectionMode.Full`
 * と同じ規則）。かすっただけで選ぶと、囲んだつもりの無い MY4N が一緒に消える。
 * 面積を持たない配線を「触れたら選ぶ」にしているのと非対称だが、
 * どちらも **枠の内側に見えているものが選ばれる**という同じ直感に落ちる。
 *
 * 定義が引けない部品は描画もされないので判定から外す。
 */
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
    const { width, height } = definition.visual;
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

/**
 * 矩形に触れている配線の ID。
 *
 * 定義や端子が見つからない配線は **黙って外す。** 座標が出せない以上、
 * 選択枠に入っているかを判定しようが無い（描画側も同じ理由で落としている）。
 */
export const connectionsInRect = (
  document: CircuitDocument,
  registry: ComponentDefinitionRegistry,
  rect: SelectionRect,
): string[] => {
  // 面積ゼロの枠（クリックや真横へのドラッグ）では何も選ばない
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

/**
 * 指定した部品のいずれかに繋がっている配線の ID。
 *
 * **React Flow が範囲選択時に Edge へ適用している規則と同じ**（片端が選択中の
 * ノードなら選ぶ）。範囲選択中の配線選択をこちらで組み立て直すために、
 * 同じ規則を明示的に持っておく。
 */
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
