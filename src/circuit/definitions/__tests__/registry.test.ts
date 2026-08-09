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
 * 「レジストリから型番で定義を取得できる」を実証するテスト。
 *
 * 端子データは design.md §4.1〜§4.3 の表と突き合わせる。
 * 表を書き換えたのに定義を直し忘れる（またはその逆）と、ここが落ちる。
 */
describe("部品定義レジストリ", () => {
  it("11 定義が登録されている", () => {
    expect(componentDefinitions.map((d) => d.id)).toEqual([
      "power-dc24v",
      "switch-pushbutton-no",
      "switch-pushbutton-nc",
      "switch-selector-no",
      "switch-selector-nc",
      "omron-my2n-dc24",
      "omron-my4n-dc24",
      "omron-my4n-d2-dc24",
      "lamp-dc24v",
      "diode-generic",
      "terminal-block-6p",
    ]);
    expect(componentRegistry.size).toBe(11);
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
      "switch-selector-no",
      "switch-selector-nc",
    ]);
    expect(listComponentDefinitions()).toHaveLength(11);
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

describe("OMRON MY2N DC24V の端子データ（design.md §4.2）", () => {
  const my2n = requireComponentDefinition("omron-my2n-dc24");

  /**
   * **本アプリの価値の中核。** 8 ピンだからといって 1〜8 に詰め直さず、
   * MY4N の 1 回路目と 4 回路目を使った飛び番のまま表示する
   * （requirements.md US-F）。
   */
  it("端子番号が 1・4・5・8・9・12・13・14 の飛び番のまま", () => {
    expect(my2n.terminals).toHaveLength(8);
    expect(my2n.terminals.map((t) => t.number)).toEqual([
      "1",
      "4",
      "5",
      "8",
      "9",
      "12",
      "13",
      "14",
    ]);
  });

  it("2 接点の NC / NO / COM が §4.2 の表と一致する", () => {
    if (my2n.electrical.kind !== "relay") throw new Error("relay ではない");
    expect(
      my2n.electrical.relay.contacts.map((c) => [
        c.id,
        c.ncTerminal,
        c.noTerminal,
        c.commonTerminal,
      ]),
    ).toEqual([
      ["c1", "1", "5", "9"],
      ["c2", "4", "8", "12"],
    ]);
  });

  it("コイルは MY4N と同じ 14 = (+) / 13 = (−) で極性は indicator", () => {
    if (my2n.electrical.kind !== "relay") throw new Error("relay ではない");
    expect(my2n.electrical.relay.coil).toMatchObject({
      positiveTerminal: "14",
      negativeTerminal: "13",
      polarity: "indicator",
    });
  });

  it("接点の説明は回路番号（第1・第2）で振られる", () => {
    // 端子番号が飛んでいても「2 回路目」であることが読めなければ意味がない
    expect(my2n.terminals.find((t) => t.id === "4")?.description).toContain(
      "第2接点",
    );
    expect(my2n.terminals.find((t) => t.id === "4")?.contactGroup).toBe("c2");
  });
});

describe("OMRON MY4N-D2 DC24V の端子データ（design.md §4.3）", () => {
  const my4n = requireComponentDefinition("omron-my4n-dc24");
  const d2 = requireComponentDefinition("omron-my4n-d2-dc24");

  /**
   * MY4N との差が `polarity` の 1 値だけであること＝データ駆動設計が
   * 機能していることの証明（requirements.md US-F）。
   */
  it("端子構成は MY4N と完全に同一", () => {
    expect(d2.terminals.map((t) => [t.id, t.role, t.contactGroup])).toEqual(
      my4n.terminals.map((t) => [t.id, t.role, t.contactGroup]),
    );
    if (d2.electrical.kind !== "relay" || my4n.electrical.kind !== "relay") {
      throw new Error("relay ではない");
    }
    expect(d2.electrical.relay.contacts).toEqual(
      my4n.electrical.relay.contacts,
    );
  });

  it("MY4N との差はコイルの極性だけ", () => {
    if (d2.electrical.kind !== "relay" || my4n.electrical.kind !== "relay") {
      throw new Error("relay ではない");
    }
    expect(d2.electrical.relay.coil.polarity).toBe("strict");
    expect(my4n.electrical.relay.coil.polarity).toBe("indicator");
    expect({ ...d2.electrical.relay.coil, polarity: null }).toEqual({
      ...my4n.electrical.relay.coil,
      polarity: null,
    });
  });

  it("コイル端子の説明にダイオード内蔵を明記する", () => {
    expect(d2.terminals.find((t) => t.id === "14")?.description).toContain(
      "ダイオード内蔵",
    );
  });
});

describe("汎用部品の追加（design.md §4.5）", () => {
  it("ダイオードはアノード / カソードを持ち、実端子番号を持たない", () => {
    const diode = requireComponentDefinition("diode-generic");
    expect(diode.category).toBe("diode");
    expect(diode.terminals.map((t) => [t.label, t.role])).toEqual([
      ["A", "anode"],
      ["K", "cathode"],
    ]);
    // 実型番を持たないので実端子番号も存在しない
    expect(diode.terminals.every((t) => t.number === undefined)).toBe(true);
  });

  it("スイッチ 4 種は端子構成が同一で、接点種別と動作だけが違う（§4.7）", () => {
    const ids = [
      "switch-pushbutton-no",
      "switch-pushbutton-nc",
      "switch-selector-no",
      "switch-selector-nc",
    ];
    const switches = ids.map(requireComponentDefinition);

    // 端子の呼称が 1 つでもずれると「1–2 で統一」という約束（§4.5）が崩れる
    for (const definition of switches) {
      expect(definition.terminals.map((t) => t.label), definition.id).toEqual([
        "1",
        "2",
      ]);
      expect(
        definition.terminals.every((t) => t.number === undefined),
        definition.id,
      ).toBe(true);
    }

    expect(
      switches.map((d) =>
        d.electrical.kind === "switch"
          ? [d.electrical.contactType, d.electrical.action]
          : null,
      ),
    ).toEqual([
      ["NO", "momentary"],
      ["NC", "momentary"],
      ["NO", "maintained"],
      ["NC", "maintained"],
    ]);
  });

  it("端子台は全端子を `electrical.terminals` に列挙する", () => {
    const block = requireComponentDefinition("terminal-block-6p");
    if (block.electrical.kind !== "terminal") throw new Error("terminal ではない");
    // ここに漏れがあるとその端子だけ導通しない静かなバグになる
    expect(block.electrical.terminals).toEqual(
      block.terminals.map((t) => t.id),
    );
    expect(block.electrical.terminals).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(block.terminals.every((t) => t.number === undefined)).toBe(true);
  });
});
