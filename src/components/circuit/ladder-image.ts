"use client";

/**
 * ラダー図を画像として保存する（design.md §8.15）。
 *
 * **絵の中身はここに無い。** 描くのは `adapter/ladder-svg.ts` の純粋関数で、
 * ここが受け持つのはブラウザ側の仕事だけ —— Blob にする、PNG へ焼く、
 * `<a download>` を押す。`useDocumentPersistence.exportToFile()` と同じ役割分担
 * （書式は純粋関数、ダウンロード操作は DOM 側）。
 *
 * PNG は SVG を `<img>` 経由で `<canvas>` へ焼いて作る。**外部ライブラリを
 * 足さない** —— 画面の DOM を写し取る道具（html2canvas 系）は、横スクロール
 * した先の段が欠けるうえ、CSS の描き方に結果が左右される。
 */

import { ladderFileName, renderLadderSvg } from "@/circuit/adapter/ladder-svg";
import type { LadderDiagram } from "@/circuit/adapter/ladder";

export const LADDER_SVG_MIME = "image/svg+xml";

/**
 * PNG の拡大率。
 *
 * 等倍で焼くと 11px の呼び名と 10.5px の端子番号が潰れる。**端子番号が
 * 読めない画像は実配線と照らす道具にならない**ので、資料に貼っても
 * 読める大きさで出す。
 */
const PNG_SCALE = 2;

/** Blob を一時 URL にして `<a download>` を押す（`exportToFile()` と同じ） */
const downloadBlob = (blob: Blob, fileName: string): void => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
};

/** SVG（ベクタ）で保存する。拡大しても線が崩れず、後から編集もできる */
export const saveLadderSvg = (diagram: LadderDiagram, now = new Date()): void => {
  const svg = renderLadderSvg(diagram, { generatedAt: now });
  downloadBlob(new Blob([svg], { type: LADDER_SVG_MIME }), ladderFileName("svg", now));
};

/**
 * PNG（ラスタ）で保存する。
 *
 * 失敗しうる経路（`<img>` の読み込み・`toBlob()`）なので、**成否を呼び出し側へ
 * 返す。** 押しても何も起きないのが一番困る —— 保存できなかったことは
 * 画面に出す必要がある。
 */
export const saveLadderPng = async (
  diagram: LadderDiagram,
  now = new Date(),
): Promise<boolean> => {
  const svg = renderLadderSvg(diagram, { generatedAt: now });
  /*
   * `<img>` に渡すのは data URL。Blob URL でもよいが、`encodeURIComponent` なら
   * 解放し忘れる URL が 1 本も残らない。日本語（呼び名・断り書き）が入るので
   * base64 ではなくパーセントエンコードで渡す
   */
  const source = `data:${LADDER_SVG_MIME};charset=utf-8,${encodeURIComponent(svg)}`;

  const image = new Image();
  const loaded = new Promise<boolean>((resolve) => {
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
  });
  image.src = source;
  if (!(await loaded)) return false;

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(image.width * PNG_SCALE);
  canvas.height = Math.ceil(image.height * PNG_SCALE);
  const context = canvas.getContext("2d");
  if (!context) return false;
  context.scale(PNG_SCALE, PNG_SCALE);
  context.drawImage(image, 0, 0);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) return false;

  downloadBlob(blob, ladderFileName("png", now));
  return true;
};
