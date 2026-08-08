import { describe, expect, it } from "vitest";

import {
  componentDefinitions,
  componentRegistry,
  findComponentDefinitionByModel,
  getComponentDefinition,
  listComponentDefinitions,
  requireComponentDefinition,
} from "@/circuit/definitions";

/**
 * Step 1 の完了判定「レジストリから型番で定義を取得できる」を実証するテスト。
 *
 * MY4N の端子データは design.md §4.1 の表と突き合わせる。
 * 表を書き換えたのに定義を直し忘れる（またはその逆）と、ここが落ちる。
 */
describe("部品定義レジストリ", () => {
  it("Step 1 の 5 定義が登録されている", () => {
    expect(componentDefinitions.map((d) => d.id)).toEqual([
      "power-dc24v",
      "switch-pushbutton-no",
      "switch-pushbutton-nc",
      "omron-my4n-dc24",
      "lamp-dc24v",
    ]);
    expect(componentRegistry.size).toBe(5);
  });

  it("型番から定義を取得できる", () => {
    const my4n = findComponentDefinitionByModel("MY4N");
    expect(my4n?.id).toBe("omron-my4n-dc24");
    expect(my4n?.manufacturer).toBe("OMRON");
  });

  it("定義 ID から取得でき、未知の ID は例外になる", () => {
    expect(getComponentDefinition("lamp-dc24v")?.category).toBe("lamp");
    expect(getComponentDefinition("no-such-id")).toBeUndefined();
    expect(() => requireComponentDefinition("no-such-id")).toThrow(
      /未知の部品定義 ID/,
    );
  });

  it("カテゴリで絞り込める", () => {
    expect(listComponentDefinitions("switch").map((d) => d.id)).toEqual([
      "switch-pushbutton-no",
      "switch-pushbutton-nc",
    ]);
    expect(listComponentDefinitions()).toHaveLength(5);
  });

  it("全定義が未検証であり、端子データの出典を持つ", () => {
    for (const definition of componentDefinitions) {
      expect(definition.verified, definition.id).toBe(false);
      expect(definition.source, definition.id).toBeTruthy();
    }
  });

  it("部品ごとに端子 ID が重複しない", () => {
    for (const definition of componentDefinitions) {
      const ids = definition.terminals.map((t) => t.id);
      expect(new Set(ids).size, definition.id).toBe(ids.length);
    }
  });

  it("電気的定義が参照する端子が実在する", () => {
    for (const definition of componentDefinitions) {
      const ids = new Set(definition.terminals.map((t) => t.id));
      const { electrical } = definition;
      const referenced: string[] =
        electrical.kind === "power"
          ? [electrical.positiveTerminal, electrical.zeroTerminal]
          : electrical.kind === "switch" || electrical.kind === "lamp"
            ? [electrical.terminalA, electrical.terminalB]
            : electrical.kind === "diode"
              ? [electrical.anodeTerminal, electrical.cathodeTerminal]
              : electrical.kind === "terminal"
                ? electrical.terminals
                : [
                    electrical.relay.coil.positiveTerminal,
                    electrical.relay.coil.negativeTerminal,
                    ...electrical.relay.contacts.flatMap((c) => [
                      c.commonTerminal,
                      c.noTerminal,
                      c.ncTerminal,
                    ]),
                  ];

      for (const terminalId of referenced) {
        expect(ids.has(terminalId), `${definition.id}:${terminalId}`).toBe(true);
      }
    }
  });
});

describe("OMRON MY4N DC24V の端子データ（design.md §4.1）", () => {
  const my4n = requireComponentDefinition("omron-my4n-dc24");

  it("端子番号が 1〜14 で欠番も重複もない", () => {
    expect(my4n.terminals).toHaveLength(14);
    expect(my4n.terminals.map((t) => t.number)).toEqual(
      Array.from({ length: 14 }, (_, i) => String(i + 1)),
    );
  });

  it("コイルは 14 が (+)、13 が (−) で、極性は indicator", () => {
    if (my4n.electrical.kind !== "relay") throw new Error("relay ではない");
    expect(my4n.electrical.relay.coil).toMatchObject({
      voltage: 24,
      currentType: "DC",
      positiveTerminal: "14",
      negativeTerminal: "13",
      polarity: "indicator",
    });
  });

  it("4 接点の NC / NO / COM が §4.1 の表と一致する", () => {
    if (my4n.electrical.kind !== "relay") throw new Error("relay ではない");
    expect(
      my4n.electrical.relay.contacts.map((c) => [
        c.id,
        c.ncTerminal,
        c.noTerminal,
        c.commonTerminal,
      ]),
    ).toEqual([
      ["c1", "1", "5", "9"],
      ["c2", "2", "6", "10"],
      ["c3", "3", "7", "11"],
      ["c4", "4", "8", "12"],
    ]);
  });

  it("接点の各端子が contactGroup で束ねられている", () => {
    if (my4n.electrical.kind !== "relay") throw new Error("relay ではない");
    for (const contact of my4n.electrical.relay.contacts) {
      for (const terminalId of [
        contact.ncTerminal,
        contact.noTerminal,
        contact.commonTerminal,
      ]) {
        const terminal = my4n.terminals.find((t) => t.id === terminalId);
        expect(terminal?.contactGroup, terminalId).toBe(contact.id);
      }
    }
  });

  it("実端子番号は未検証のまま扱う", () => {
    expect(my4n.verified).toBe(false);
    expect(my4n.source).toMatch(/^https?:\/\//);
  });
});
