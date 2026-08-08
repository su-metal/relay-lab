/**
 * 永続化の検証（design.md §7）。
 *
 * 守りたいのは「保存 → 読込 で回路が同じ形に戻る」ことと、
 * **壊れた保存データがドキュメントへ素通りしない**こと。
 * 実在しない部品定義や端子を指す JSON を通すと、エンジンが存在しない端子の
 * ネットを引いて静かに壊れる（要件 US-E）。
 */

import { describe, expect, it } from "vitest";

import { componentRegistry } from "@/circuit/definitions";
import {
  parseDocument,
  serializeDocument,
} from "@/circuit/persistence/document-storage";
import type { CircuitDocument } from "@/circuit/types";

const document: CircuitDocument = {
  version: 1,
  components: [
    {
      id: "cmp-power",
      definitionId: "power-dc24v",
      label: "PS1",
      position: { x: 40, y: 60 },
    },
    {
      id: "cmp-relay",
      definitionId: "omron-my4n-dc24",
      label: "RY1",
      position: { x: 320, y: 60 },
    },
  ],
  connections: [
    {
      id: "wire-1",
      from: { componentId: "cmp-power", terminalId: "plus" },
      to: { componentId: "cmp-relay", terminalId: "13" },
    },
  ],
  viewport: { x: -20, y: 10, zoom: 1.25 },
};

/** JSON を作って読み戻す。テスト側で JSON.stringify を書き散らさないための道具 */
const roundTrip = (value: unknown) =>
  parseDocument(JSON.stringify(value), componentRegistry);

describe("serializeDocument / parseDocument", () => {
  it("保存して読み戻すと同じドキュメントになる", () => {
    const result = parseDocument(serializeDocument(document), componentRegistry);

    expect(result.status).toBe("loaded");
    if (result.status !== "loaded") return;
    expect(result.document).toEqual(document);
    expect(result.dropped).toEqual([]);
  });

  it("保存が無いときは empty を返す（壊れているとは区別する）", () => {
    expect(parseDocument(null, componentRegistry).status).toBe("empty");
    expect(parseDocument("", componentRegistry).status).toBe("empty");
  });

  it("JSON として壊れていれば invalid を返す", () => {
    const result = parseDocument("{ではない", componentRegistry);

    expect(result.status).toBe("invalid");
  });

  it("未対応の version は読み込まない", () => {
    const result = roundTrip({ ...document, version: 2 });

    expect(result.status).toBe("invalid");
  });
});

describe("parseDocument の要素検証", () => {
  it("未知の definitionId の部品を弾き、その端子への配線も落とす", () => {
    const result = roundTrip({
      ...document,
      components: [
        ...document.components,
        {
          id: "cmp-ghost",
          definitionId: "not-registered",
          label: "X1",
          position: { x: 0, y: 400 },
        },
      ],
      connections: [
        ...document.connections,
        {
          id: "wire-ghost",
          from: { componentId: "cmp-ghost", terminalId: "a" },
          to: { componentId: "cmp-relay", terminalId: "14" },
        },
      ],
    });

    expect(result.status).toBe("loaded");
    if (result.status !== "loaded") return;
    expect(result.document.components.map((c) => c.id)).toEqual([
      "cmp-power",
      "cmp-relay",
    ]);
    expect(result.document.connections.map((c) => c.id)).toEqual(["wire-1"]);
    // 捨てた事実は必ず理由付きで返す。黙って消すと回路が減った理由が分からない
    expect(result.dropped).toHaveLength(2);
    expect(result.dropped[0]).toContain("not-registered");
  });

  it("定義に存在しない端子を指す配線を弾く", () => {
    const result = roundTrip({
      ...document,
      connections: [
        {
          id: "wire-bad",
          from: { componentId: "cmp-power", terminalId: "plus" },
          // MY4N に 99 番端子は無い
          to: { componentId: "cmp-relay", terminalId: "99" },
        },
      ],
    });

    expect(result.status).toBe("loaded");
    if (result.status !== "loaded") return;
    expect(result.document.connections).toEqual([]);
    expect(result.dropped).toHaveLength(1);
  });

  it("同じ端子間の重複配線は 1 本にする", () => {
    const result = roundTrip({
      ...document,
      connections: [
        ...document.connections,
        {
          id: "wire-2",
          // 向きを入れ替えただけの同一配線
          from: { componentId: "cmp-relay", terminalId: "13" },
          to: { componentId: "cmp-power", terminalId: "plus" },
        },
      ],
    });

    expect(result.status).toBe("loaded");
    if (result.status !== "loaded") return;
    expect(result.document.connections.map((c) => c.id)).toEqual(["wire-1"]);
  });

  it("座標や ID が壊れた部品だけを落とし、残りは読み込む", () => {
    const result = roundTrip({
      ...document,
      components: [
        ...document.components,
        { definitionId: "power-dc24v", position: { x: 0, y: 0 } },
        {
          id: "cmp-nan",
          definitionId: "lamp-dc24v",
          position: { x: "40", y: 0 },
        },
      ],
    });

    expect(result.status).toBe("loaded");
    if (result.status !== "loaded") return;
    expect(result.document.components).toHaveLength(2);
    expect(result.dropped).toHaveLength(2);
  });

  it("ズーム 0 のような描画不能なビューポートは既定へ戻す", () => {
    const result = roundTrip({
      ...document,
      viewport: { x: 10, y: 10, zoom: 0 },
    });

    expect(result.status).toBe("loaded");
    if (result.status !== "loaded") return;
    expect(result.document.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
  });
});
