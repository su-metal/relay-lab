import { describe, expect, it } from "vitest";

import { componentRegistry } from "@/circuit/definitions";
import {
  CIRCUIT_FILE_ACCEPT,
  CIRCUIT_FILE_MIME,
  circuitFileName,
  serializeDocumentToFile,
} from "@/circuit/persistence/document-file";
import { parseDocument } from "@/circuit/persistence/document-storage";
import type { CircuitDocument } from "@/circuit/types";

/**
 * ファイル書き出しの検証（design.md §7）。
 *
 * 一番大事なのは「書き出したファイルを読み込み直せる」こと。
 * 書式の判定規則を `parseDocument()` に一本化してあるので、
 * ここでも読み戻しにはそれを使う。
 */

const document: CircuitDocument = {
  version: 1,
  components: [
    {
      id: "PS1",
      definitionId: "power-dc24v",
      label: "PS1",
      position: { x: 40, y: 440 },
    },
    {
      id: "S1",
      definitionId: "switch-selector-no",
      label: "S1",
      position: { x: 300, y: 60 },
      flipped: true,
    },
    {
      id: "RY1",
      definitionId: "omron-my4n-dc24",
      label: "RY1",
      position: { x: 600, y: 60 },
    },
  ],
  connections: [
    {
      id: "w1",
      from: { componentId: "PS1", terminalId: "plus" },
      to: { componentId: "S1", terminalId: "1" },
    },
    {
      id: "w2",
      from: { componentId: "S1", terminalId: "2" },
      to: { componentId: "RY1", terminalId: "14" },
    },
    {
      id: "w3",
      from: { componentId: "RY1", terminalId: "13" },
      to: { componentId: "PS1", terminalId: "zero" },
    },
  ],
  viewport: { x: -120, y: 30, zoom: 0.75 },
};

describe("回路ファイルの書き出し", () => {
  it("書き出したファイルをそのまま読み戻せる", () => {
    const outcome = parseDocument(
      serializeDocumentToFile(document),
      componentRegistry,
    );
    if (outcome.status !== "loaded") {
      throw new Error(`読み込めなかった: ${outcome.status}`);
    }
    // 表示位置と左右反転まで含めて往復すること。ここが欠けると、
    // 渡した相手の画面で回路がどこにあるか分からなくなる
    expect(outcome.document).toEqual(document);
    expect(outcome.dropped).toEqual([]);
  });

  /**
   * 整形して書くことが要件（人が開いて確かめ、課題として提出する対象）。
   * LocalStorage 用の `serializeDocument()` は 1 行のままでよい。
   */
  it("人が読めるよう整形され、末尾に改行が付く", () => {
    const text = serializeDocumentToFile(document);
    expect(text.split("\n").length).toBeGreaterThan(20);
    expect(text.startsWith("{\n  ")).toBe(true);
    expect(text.endsWith("}\n")).toBe(true);
  });

  it("空の回路も書き出して読み戻せる", () => {
    const empty: CircuitDocument = {
      version: 1,
      components: [],
      connections: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    const outcome = parseDocument(
      serializeDocumentToFile(empty),
      componentRegistry,
    );
    expect(outcome).toMatchObject({ status: "loaded", document: empty });
  });
});

describe("書き出すファイル名", () => {
  it("日時が入り、拡張子は .json", () => {
    expect(circuitFileName(new Date(2026, 7, 9, 15, 4))).toBe(
      "relay-lab-20260809-1504.json",
    );
  });

  it("月・日・時・分が 2 桁に揃う", () => {
    expect(circuitFileName(new Date(2026, 0, 1, 0, 0))).toBe(
      "relay-lab-20260101-0000.json",
    );
  });

  /**
   * 課題の提出や別 OS への受け渡しで化ける経路を作らない（§7）。
   * 半角英数・ハイフン・ドット以外が入ったらここで落ちる。
   */
  it("日本語や空白を含まない", () => {
    expect(circuitFileName(new Date(2026, 11, 31, 23, 59))).toMatch(
      /^[A-Za-z0-9.-]+$/,
    );
  });
});

describe("ファイルダイアログの設定", () => {
  it("MIME と accept が JSON を指す", () => {
    expect(CIRCUIT_FILE_MIME).toBe("application/json");
    expect(CIRCUIT_FILE_ACCEPT).toContain(".json");
  });
});
