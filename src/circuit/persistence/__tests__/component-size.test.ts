import { describe, expect, it } from "vitest";

import { componentRegistry, dc24vPowerSupply } from "@/circuit/definitions";
import { parseDocument, serializeDocument } from "@/circuit/persistence/document-storage";
import type { CircuitDocument } from "@/circuit/types";

const rawDocument = (size: unknown) =>
  JSON.stringify({
    version: 1,
    components: [
      {
        id: "PS1",
        definitionId: dc24vPowerSupply.id,
        position: { x: 10, y: 20 },
        size,
      },
    ],
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  });

describe("部品サイズの保存・復元", () => {
  it("拡大した寸法を読み戻す", () => {
    const size = {
      width: dc24vPowerSupply.visual.width + 90,
      height: dc24vPowerSupply.visual.height + 60,
    };
    const result = parseDocument(rawDocument(size), componentRegistry);

    expect(result.status).toBe("loaded");
    if (result.status !== "loaded") return;
    expect(result.document.components[0]?.size).toEqual(size);
  });

  it("既定寸法未満の保存値は既定寸法へ戻す", () => {
    const result = parseDocument(
      rawDocument({ width: 1, height: 1 }),
      componentRegistry,
    );

    expect(result.status).toBe("loaded");
    if (result.status !== "loaded") return;
    expect(result.document.components[0]?.size).toBeUndefined();
  });

  it("サイズは通常のドキュメントJSONにそのまま保存される", () => {
    const size = {
      width: dc24vPowerSupply.visual.width + 40,
      height: dc24vPowerSupply.visual.height + 20,
    };
    const document: CircuitDocument = {
      version: 1,
      components: [
        {
          id: "PS1",
          definitionId: dc24vPowerSupply.id,
          position: { x: 0, y: 0 },
          size,
        },
      ],
      connections: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    expect(JSON.parse(serializeDocument(document)).components[0].size).toEqual(size);
  });
});
