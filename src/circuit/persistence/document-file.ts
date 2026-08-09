/**
 * 回路ドキュメントのファイル書き出し（design.md §7）。
 *
 * LocalStorage への保存（`document-storage.ts`）は**このブラウザの中だけ**の話で、
 * 別の PC へ回路を渡す手段が無かった。ここは「1 枚のファイルとして持ち出す」側。
 *
 * **読み込み側の関数はここに作らない。** ファイルから読む JSON は LocalStorage の
 * JSON と同じ形式・同じ危険度（未知の部品定義・存在しない端子）なので、
 * `parseDocument()` をそのまま使う。書式の判定規則が 2 箇所に分かれると、
 * 片方だけ厳しくなって「保存はできるのに読み込めないファイル」が生まれる。
 *
 * このファイルは React も DOM も import しない純粋関数なので Vitest で検証できる。
 * 実際のダウンロード操作（Blob / <a download>）は `useDocumentPersistence` 側。
 */

import type { CircuitDocument } from "@/circuit/types";

export const CIRCUIT_FILE_MIME = "application/json";

/** ファイル選択ダイアログの絞り込み（`<input accept>`） */
export const CIRCUIT_FILE_ACCEPT = "application/json,.json";

const pad2 = (value: number): string => String(value).padStart(2, "0");

/**
 * 書き出すファイル名（`relay-lab-20260809-1530.json`）。
 *
 * 日時を入れるのは、同じ回路を何度も書き出したときに `(1)` `(2)` が付いて
 * どれが新しいのか分からなくなるため。**日本語を含めない** —— 課題の提出や
 * 別 OS への受け渡しでファイル名が化ける経路を作らない。
 */
export const circuitFileName = (now: Date = new Date()): string => {
  const date = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
  const time = `${pad2(now.getHours())}${pad2(now.getMinutes())}`;
  return `relay-lab-${date}-${time}.json`;
};

/**
 * ファイルへ書く JSON。
 *
 * LocalStorage 用の `serializeDocument()` と違い**整形して改行を入れる。**
 * 書き出したファイルは人が開いて中身を確かめたり、課題として提出したり、
 * 差分を見たりする対象になる。1 行 20KB の JSON ではそれができない。
 */
export const serializeDocumentToFile = (document: CircuitDocument): string =>
  `${JSON.stringify(document, null, 2)}\n`;
