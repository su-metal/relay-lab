"use client";

/**
 * 「揃える」の呼び出し口（design.md §8.13）。
 *
 * `auto-arrange.ts` と同じ形。**ストアは購読せずその場で `getState()` で読む** ——
 * 選択が変わるたびに Toolbar のハンドラーを作り直す理由が無い。判定そのものは
 * `adapter/align.ts` の純粋関数が持ち、ここはレジストリと選択を与えて結果を
 * ストアへ渡すだけ。
 *
 * **自動整理と違い、選択が空なら何もしない。** `runAutoArrange` は選択が無ければ
 * 全体を整えるが、揃えるを全体に掛けると図面が 1 本の線に潰れる（§8.13）。
 */

import { alignComponents, minimumSelection } from "@/circuit/adapter/align";
import type { AlignMode } from "@/circuit/adapter/align";
import { componentRegistry } from "@/circuit/definitions";
import { useCircuitStore } from "@/store/circuitStore";

export type { AlignMode };

export function runAlign(mode: AlignMode): void {
  const { document, selectedComponentIds, applyLayout } =
    useCircuitStore.getState();

  const positions = alignComponents(
    document,
    componentRegistry,
    selectedComponentIds,
    mode,
  );
  // 既に揃っていれば空の Map が返る。applyLayout 側でも弾くが、
  // 「押しても何も起きない」が正しい結果であることをここで明示しておく
  applyLayout(positions);
}

export type AlignMenuItem = {
  mode: AlignMode;
  /** メニューに出す記号。矢印の向きが動く方向を表す */
  icon: string;
  label: string;
  /** `title` 属性。何が基準になるのかを書く */
  description: string;
};

/**
 * メニューの中身（`Toolbar`）。
 *
 * 並びは **左右方向の 4 つ → 上下方向の 4 つ。** メニューは 2 列で開き
 * （`Toolbar.module.css` の `grid-auto-flow: column`）、**左列が左右方向、
 * 右列が上下方向**になる。軸ごとに列がまとまっていないと、「左揃え」の隣に
 * 「上揃え」が並ぶような読みにくい表になる。
 *
 * `description` に**基準**を必ず書く。「左揃え」だけでは、選択のいちばん左に
 * 揃うのか画面の左に揃うのかが読めない。
 */
export const ALIGN_MENU_ITEMS: readonly AlignMenuItem[] = [
  {
    mode: "left",
    icon: "⇤",
    label: "左揃え",
    description: "選択した部品の左端を、いちばん左の部品に合わせます",
  },
  {
    mode: "center-x",
    icon: "↔",
    label: "左右中央",
    description: "選択した部品の中心を、左右方向の中央に合わせます",
  },
  {
    mode: "right",
    icon: "⇥",
    label: "右揃え",
    description: "選択した部品の右端を、いちばん右の部品に合わせます",
  },
  {
    mode: "distribute-x",
    icon: "⇹",
    label: "左右に均等",
    description:
      "両端の部品はそのままに、部品の中心が左右に等間隔で並ぶようにします（3 個以上）",
  },
  {
    mode: "top",
    icon: "⤒",
    label: "上揃え",
    description: "選択した部品の上端を、いちばん上の部品に合わせます",
  },
  {
    mode: "center-y",
    icon: "↕",
    label: "上下中央",
    description: "選択した部品の中心を、上下方向の中央に合わせます",
  },
  {
    mode: "bottom",
    icon: "⤓",
    label: "下揃え",
    description: "選択した部品の下端を、いちばん下の部品に合わせます",
  },
  {
    mode: "distribute-y",
    icon: "⇳",
    label: "上下に均等",
    description:
      "両端の部品はそのままに、部品の中心が上下に等間隔で並ぶようにします（3 個以上）",
  },
];

/** その項目が押せるか。均等だけ 3 個要る（`minimumSelection`） */
export const canRunAlign = (mode: AlignMode, selectedCount: number): boolean =>
  selectedCount >= minimumSelection(mode);
