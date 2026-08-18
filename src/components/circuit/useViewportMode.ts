"use client";

/**
 * 画面モードの判定（design.md §8.12）。
 *
 * モバイルで変えるものは 2 つあり、**それぞれ判定の軸が違う。**
 *
 * - **狭さ**（`useCompactLayout`）— 3 カラムが成り立たない幅。パネルを下から出す
 *   シートへ畳み、操作バーを短い名前に切り替える
 * - **指**（`useCoarsePointer`）— ホバーが無く、狙える精度が粗い入力。1 本指の
 *   ドラッグを画面移動に充て、当たり判定を広げ、パレットをタップで置けるようにする
 *
 * 幅と入力は独立している。狭いデスクトップの窓（マウス）でも、広いタブレット
 * （指）でも片方だけが立つので、1 つの「モバイルか」に畳んではいけない。
 *
 * **判定はここ 1 箇所。CSS 側にブレークポイントを二重に持たせない。** 狭いときの
 * 見た目は `data-compact` 属性を根に付けて CSS を切り替える（同じ数値を CSS と
 * TypeScript に書くと、片方だけ直したときに構造と見た目がずれる）。ホバーの有無
 * （`pointer: coarse`）だけは端末の性質でレイアウトの都合ではないので、
 * 当たり判定まわりの CSS は素直にメディアクエリで書いてよい。
 */

import { useEffect, useState } from "react";

/**
 * 3 カラムを畳む幅。左 240px ＋ 右 280px を引いてキャンバスに残るのが 380px を
 * 切ると、部品 1 個（MY4N で 200px 弱）を置いて配線を追う余地が無くなる。
 */
export const COMPACT_MAX_WIDTH = 900;

const COMPACT_QUERY = `(max-width: ${COMPACT_MAX_WIDTH}px)`;

/** ホバーを持たず、狙える精度が粗い入力（指・スタイラス） */
const COARSE_QUERY = "(pointer: coarse)";

/**
 * **初期値は必ず `false`（＝デスクトップ）。**
 *
 * 静的書き出し（`out/`）した HTML には画面が無く、サーバー側では
 * `window.matchMedia` を読めない。初回描画をデスクトップに固定し、
 * マウント後の効果で切り替えることで、ハイドレーションの食い違いを避ける。
 */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);

  return matches;
}

/** 3 カラムを畳んで、パネルを下から出すシートに切り替えるか */
export const useCompactLayout = (): boolean => useMediaQuery(COMPACT_QUERY);

/** 指で触っているか（ホバーが無く、当たり判定を広げる必要がある入力か） */
export const useCoarsePointer = (): boolean => useMediaQuery(COARSE_QUERY);
