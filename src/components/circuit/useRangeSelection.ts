"use client";

/**
 * 範囲選択（ラバーバンド）の選択判定（design.md §8.6）。
 *
 * **枠を引いている間の選択は、部品も配線もここが丸ごと決める。**
 * `CircuitCanvas` の `onNodesChange` / `onEdgesChange` は枠が出ている間の
 * select 変更を捨て、代わりに毎フレームこちらが選択集合を組み立て直す。
 *
 * React Flow に任せられない理由は 2 つ。
 *
 * 1. **配線そのものを枠で選べない。** React Flow の範囲選択は枠に入った
 *    「ノード」と、そのノードに繋がる Edge しか選ばない。電源とリレーを結ぶ
 *    長い 1 本を途中で囲んで消す、という図面の直しが成立しない。
 * 2. **対象の絞り込み（部品のみ / 配線のみ）を後から間引けない。** React Flow は
 *    選択変更を流すときに内部の `nodeLookup` / `edgeLookup` の `selected` を
 *    同時に書き換える。こちらで変更を握り潰すと「React Flow は選択済みだと
 *    思っているのに画面は非選択」という食い違いが残り、**その部品は以後
 *    クリックしても選べなくなる。** 間引くのではなく、こちらが毎フレーム
 *    全体を宣言し直して食い違いを毎フレーム解消する。
 *
 * 単体クリックと Ctrl/⌘+クリックには一切関与しない（枠が無い間は何もしない）。
 * プロパティパネルを見るために部品をクリックする操作まで対象設定に縛られない。
 */

import { useStore } from "@xyflow/react";
import { useEffect } from "react";

import {
  componentsInRect,
  connectionsInRect,
  connectionsOfComponents,
} from "@/circuit/adapter/selection";
import type { SelectionRect } from "@/circuit/adapter/selection";
import { componentRegistry } from "@/circuit/definitions";
import { useCircuitStore } from "@/store/circuitStore";

import type { RangeSelectionTarget } from "./range-selection";

/**
 * React Flow の選択枠（コンテナ基準のスクリーン座標）をキャンバス座標へ直す。
 * `transform` は `[x, y, zoom]`。
 */
const toCanvasRect = (
  rect: { x: number; y: number; width: number; height: number },
  [offsetX, offsetY, zoom]: [number, number, number],
): SelectionRect => ({
  x: (rect.x - offsetX) / zoom,
  y: (rect.y - offsetY) / zoom,
  width: rect.width / zoom,
  height: rect.height / zoom,
});

export function useRangeSelection(target: RangeSelectionTarget): void {
  // 枠を描いている間だけ非 null。ドラッグのたびに新しいオブジェクトが来るので
  // effect は 1 フレームに 1 回走る
  const userSelectionRect = useStore((state) => state.userSelectionRect);
  const transform = useStore((state) => state.transform);

  useEffect(() => {
    if (!userSelectionRect) return;

    const rect = toCanvasRect(userSelectionRect, transform);
    const { document, setSelectedComponents, setSelectedConnections } =
      useCircuitStore.getState();

    // 部品は枠に収まったものだけ、配線は枠に触れたもの
    const components =
      target === "connections"
        ? []
        : componentsInRect(document, componentRegistry, rect);

    let connections: string[] = [];
    if (target !== "components") {
      const touched = connectionsInRect(document, componentRegistry, rect);
      connections =
        target === "connections"
          ? touched
          : // 「部品＋配線」では、選択された部品に繋がる配線も足す
            // （枠に入った部品の配線が選ばれないと、囲んだ範囲がそのまま消せない）
            [
              ...new Set([
                ...connectionsOfComponents(document, components),
                ...touched,
              ]),
            ];
    }

    setSelectedComponents(components);
    setSelectedConnections(connections);
  }, [userSelectionRect, transform, target]);
}
