/**
 * 選択した部品を揃える（design.md §8.13）。
 *
 * **自動整理（`auto-layout.ts`）とは役割が違う。** あちらは「描いた並びを崩さずに
 * 整える」もので、`ALIGN_TOLERANCE` を超えて離れた部品は揃わない。こちらは
 * **ユーザーが選んだ部品を、ユーザーが指定した基準へ意図的に動かす。** 制御盤の
 * 図面は列を作って描くので、「この 3 個だけ左端を合わせる」が要る。
 *
 * `@xyflow/react` も React も import しない純粋関数。座標だけを受け取り、
 * **動かす必要のある部品の新しい位置だけ**を返す。
 */

import type {
  CircuitDocument,
  ComponentDefinitionRegistry,
} from "@/circuit/types";

import type { Point } from "./selection";

/**
 * 揃え方。前 6 つが「揃える」、後ろ 2 つが「均等」。
 *
 * `center-x` は**左右の中心**（x 座標を揃える）、`center-y` は上下の中心。
 * 軸の名前を「揃う座標の軸」に取っており、`distribute-x` も同じく x 方向へ配る。
 */
export type AlignMode =
  | "left"
  | "center-x"
  | "right"
  | "top"
  | "center-y"
  | "bottom"
  | "distribute-x"
  | "distribute-y";

/** 均等（`distribute-*`）かどうか。必要な選択数が違うので UI 側でも使う */
export const isDistributeMode = (mode: AlignMode): boolean =>
  mode === "distribute-x" || mode === "distribute-y";

/**
 * 操作に要る最小の選択数。
 *
 * **揃えるは 2 個から。** 1 個では「何に揃えるのか」が無く、押しても必ず
 * 空振りになる。**均等は 3 個から** —— 2 個では間隔が 1 つしか無く、
 * 均等にする余地が無い（両端は動かさないため結果が必ず元のまま）。
 */
export const minimumSelection = (mode: AlignMode): number =>
  isDistributeMode(mode) ? 3 : 2;

/** 1 軸ぶんの部品。`start` は左上座標、`size` は幅または高さ */
type Span = { id: string; start: number; size: number; origin: Point };

/** その軸で部品が占める範囲の中心 */
const centerOf = (span: Span): number => span.start + span.size / 2;

/**
 * 揃えた後の `start` を求める。
 *
 * **グリッドへは吸着しない。** 吸着すると「いちばん左の部品に揃えたのに、
 * その部品まで動く」ことになり、何を基準に揃ったのかが読めなくなる。
 * 整数へ丸めるだけに留める（先に自動整理を掛けてあれば結果はグリッドに乗る）。
 */
const alignedStarts = (spans: readonly Span[], mode: AlignMode): number[] => {
  const minStart = Math.min(...spans.map((span) => span.start));
  const maxEnd = Math.max(...spans.map((span) => span.start + span.size));

  switch (mode) {
    case "left":
    case "top":
      // 左端（上端）に合わせる。いちばん外側の部品は動かない
      return spans.map(() => minStart);

    case "right":
    case "bottom":
      // 右端（下端）を合わせるので、左上座標は部品ごとに変わる
      return spans.map((span) => maxEnd - span.size);

    case "center-x":
    case "center-y": {
      // 選択全体の外接矩形の中心へ、各部品の中心を寄せる
      const center = (minStart + maxEnd) / 2;
      return spans.map((span) => Math.round(center - span.size / 2));
    }

    case "distribute-x":
    case "distribute-y": {
      /**
       * 均等 —— **部品の中心を等間隔に並べる。**
       *
       * 隙間を等しくする流儀もあるが、こちらを採る。中心が等間隔なら
       * 部品の幅が変わっても「列のピッチ」が一定に保たれ、ラダー図の
       * 列として読める。
       *
       * 中心の最小・最大を持つ 2 個は動かさず、その間を `n-1` 等分する。
       */
      const ordered = [...spans].sort(
        (a, b) =>
          centerOf(a) - centerOf(b) ||
          // 中心が同じなら ID で決める。並びが入力順に依存すると、
          // 同じ操作を 2 回押して結果が変わる
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
      // 入力と同じ並びに戻す
      return spans.map((span) => byId.get(span.id) as number);
    }
  }
};

/** その軸が x か（`false` なら y） */
const isHorizontal = (mode: AlignMode): boolean =>
  mode === "left" ||
  mode === "center-x" ||
  mode === "right" ||
  mode === "distribute-x";

/**
 * 揃えた後の位置を求める。**変わる部品だけ**を `componentId → 位置` で返す。
 *
 * `targetIds` は**必須**。自動整理（`arrangeComponents`）は省略すると全体が
 * 対象になるが、**揃えるでそれをやると図面全部が 1 本の線に潰れる。**
 *
 * 定義が引けない部品は対象から外す（`auto-layout.ts` と同じ扱い）。寸法が
 * 分からず、そもそも描画もされていない。
 *
 * **重なりは解消しない。** 左揃えすれば縦に重なることはあるが、それは指示した
 * 結果であって、勝手に逃がすと「揃えたのに揃っていない」になる。重なりを解く
 * のは自動整理（L）の役目 —— 操作を分けてある。
 *
 * 選択が足りない・既に揃っているときは **空の Map** を返す。呼び出し側は
 * これで空振りを判別でき、Undo 履歴に何も積まれない。
 */
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
    spans.push({
      id: instance.id,
      start: horizontal ? instance.position.x : instance.position.y,
      size: horizontal
        ? definition.visual.width
        : definition.visual.height,
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
