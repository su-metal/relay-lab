"use client";

/**
 * 配置の自動整理の呼び出し口（design.md §8.9）。
 *
 * 操作バーのボタンと L キーのショートカットが同じ 1 本を通る。
 * **フックにしていない**のは、両方から使うと `window` のリスナーが二重に張られる
 * ためで、`useFlipShortcut` と同じく **ストアは購読せずその場で `getState()` で読む。**
 * 選択が変わるたびに Toolbar のハンドラーを作り直す理由が無い。
 *
 * 対象は **選択中があればそれだけ、無ければ全体。**「選択を削除」と同じ考え方で、
 * 一帯だけ直したいときは囲んでから押す。判定そのものは `adapter/auto-layout.ts` の
 * 純粋関数が持ち、ここはレジストリと選択を与えて結果をストアへ渡すだけ。
 */

import { arrangeComponents } from "@/circuit/adapter/auto-layout";
import { componentRegistry } from "@/circuit/definitions";
import { useCircuitStore } from "@/store/circuitStore";

export function runAutoArrange(): void {
  const { document, selectedComponentIds, applyLayout } =
    useCircuitStore.getState();

  const positions = arrangeComponents(
    document,
    componentRegistry,
    selectedComponentIds.length > 0 ? selectedComponentIds : undefined,
  );
  // 既に整っていれば空の Map が返る。applyLayout 側でも弾くが、
  // 「押しても何も起きない」が正しい結果であることをここで明示しておく
  applyLayout(positions);
}
