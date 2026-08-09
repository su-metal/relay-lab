/**
 * 配置の自動整理（design.md §8.9）。
 *
 * **並べ直すのではなく、描いた並びを整える。** 電源を左・負荷を右といった
 * 回路構造からの自動レイアウトは採らない。図面のどこに何を置くかは書いた本人の
 * 意図であり、それを毎回作り直す機能は「整理」ではなく「作り替え」になる。
 * ここでやるのは 3 つだけ。
 *
 * 1. **グリッド吸着** — 部品の左上をキャンバスのドット（`LAYOUT_GRID`）へ乗せる
 * 2. **行・列の整列** — ほぼ揃っている部品どうしを同じ座標へ寄せる
 * 3. **重なりの解消** — 重なった部品だけを下へ逃がす
 *
 * `@xyflow/react` も React も import しない純粋関数。座標だけを受け取り、
 * **動かす必要のある部品の新しい位置だけ**を返す。呼び出し側（`auto-arrange.ts`）が
 * レジストリと選択を与え、結果をストアへ 1 手として渡す。
 */

import type {
  CircuitDocument,
  ComponentDefinitionRegistry,
} from "@/circuit/types";

import type { Point } from "./selection";

/**
 * 吸着するグリッドの間隔。
 *
 * `CircuitCanvas` の `<Background variant={Dots} gap={16} />` と同じ値にしてある。
 * 整列した部品の左上が画面のドットにぴったり乗るので、揃ったことが目で分かる。
 */
export const LAYOUT_GRID = 16;

/**
 * 「揃っている」とみなす座標のずれ（px）。
 *
 * 部品は 130〜260px なので、グリッド 2 個ぶん（32px）までのずれは
 * 「揃えたつもりで揃っていない」と読める。これを広げすぎると、意図して段違いに
 * 置いた部品まで 1 列に吸い寄せられる。
 */
export const ALIGN_TOLERANCE = LAYOUT_GRID * 2;

/**
 * 重なりを解いて逃がすときに空ける間隔（px）。
 * 部品どうしが接して並ぶと、間を通る配線が本体に隠れて追えなくなる。
 */
export const LAYOUT_GAP = LAYOUT_GRID * 2;

type Rect = { x: number; y: number; width: number; height: number };

const snap = (value: number): number =>
  Math.round(value / LAYOUT_GRID) * LAYOUT_GRID;

/** 押し下げ先はグリッドの下側へ丸める。丸め戻して重なりが再発しないため */
const snapDown = (value: number): number =>
  Math.ceil(value / LAYOUT_GRID) * LAYOUT_GRID;

/** 辺が接しているだけ（座標が等しい）は重なりとみなさない */
const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

/**
 * 1 軸ぶんの整列。近い値をひとまとめにし、その平均をグリッドへ吸着した値を
 * クラスタ全員に配る。返す配列は入力と同じ並び。
 *
 * **クラスタの基準は先頭の値で、1 つ前の値ではない。** 直前の値から数えると、
 * 32px ずつずれた部品が数珠つなぎに 1 つのクラスタとなり、図面の端から端までが
 * 1 列へ潰れる。先頭基準なら 1 クラスタの幅は必ず `ALIGN_TOLERANCE` 以内に収まる。
 */
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
    // 平均へ寄せる。先頭の値を代表にすると、クラスタ全体が一番外側の
    // 1 個に引っ張られて図面がじわじわ動く
    const aligned = snap(sum / (end - start));
    for (let index = start; index < end; index += 1) {
      result[order[index].index] = aligned;
    }
    start = end;
  }
  return result;
};

/**
 * 整理後の位置を求める。**変わる部品だけ**を `componentId → 位置` で返す。
 *
 * `targetIds` を渡すとその部品だけを動かし、**それ以外の部品は動かさないまま
 * 障害物として扱う**（選択した一帯を整えた結果、周りの部品に重なっては困る）。
 * 省略すると全部品が対象になる。
 *
 * 定義が引けない部品は対象からも障害物からも外す。寸法が分からず、そもそも
 * 描画もされていない（`toDeviceNodes`）ので、重なりを判定しようがない。
 *
 * 既に整っていれば **空の Map** を返す。呼び出し側はこれで「押しても何も
 * 起きない」を判別でき、Undo 履歴に空振りの 1 手が積まれない。
 */
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
    const rect: Rect = {
      x: instance.position.x,
      y: instance.position.y,
      width: definition.visual.width,
      height: definition.visual.height,
    };
    if (scope && !scope.has(instance.id)) {
      fixed.push(rect);
    } else {
      targets.push({ id: instance.id, origin: instance.position, rect });
    }
  }

  if (targets.length === 0) return new Map();

  // 行と列は別々に揃える。x と y を独立に見ることで、縦に並んだ列は列として、
  // 横に並んだ行は行として揃い、片方だけ揃えた配置もそのまま活きる
  const xs = alignedValues(targets.map((target) => target.rect.x));
  const ys = alignedValues(targets.map((target) => target.rect.y));
  targets.forEach((target, index) => {
    target.rect.x = xs[index];
    target.rect.y = ys[index];
  });

  /**
   * 重なりの解消。上から順に置き、既に置いたものと重なったら**下へ逃がす。**
   *
   * 逃がす向きを下に固定しているのは、ラダー図が上から下へ読むものだから。
   * 横へ逃がすと揃えたばかりの列が崩れる。
   */
  const placed: Rect[] = [...fixed];
  const ordered = [...targets].sort(
    (a, b) =>
      a.rect.y - b.rect.y ||
      a.rect.x - b.rect.x ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  for (const target of ordered) {
    // 1 回逃がすたびに y は必ず障害物 1 個ぶん下がるので、障害物の数だけ
    // 繰り返せば必ず空きに着く。念のため上限を切っておく
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
