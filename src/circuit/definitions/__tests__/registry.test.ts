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
  it("24 定義が登録されている", () => {
    expect(componentDefinitions.map((d) => d.id)).toEqual([
      "power-dc24v",
      "power-ac100v",
      "switch-pushbutton-no",
      "switch-pushbutton-nc",
      "switch-selector-no",
      "switch-selector-nc",
      "omron-my2n-dc24",
      "omron-my4n-dc24",
      "omron-my4n-d2-dc24",
      "omron-g7l-1a-b-dc24",
      "omron-g7l-2a-b-dc24",
      "contactor-generic-3p-1a1b",
      "timer-on-delay",
      "timer-off-delay",
      "lamp-dc24v",
      "lamp-ac100v",
      "lamp-dimmable-ac100v",
      "dimmer-0-10v",
      "dimming-controller-16ch",
      "dimmer-phase-control-ac100v",
      "light-controller-4ch",
      "dimming-console",
      "diode-generic",
      "terminal-block-6p",
    ]);
    expect(componentRegistry.size).toBe(24);
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
    expect(listComponentDefinitions("relay").map((d) => d.id)).toEqual([
      "omron-my2n-dc24",
      "omron-my4n-dc24",
      "omron-my4n-d2-dc24",
      "omron-g7l-1a-b-dc24",
      "omron-g7l-2a-b-dc24",
      // 電磁接触器も電気的にはリレー。パレットのカテゴリも分けていないので
      // relay 側に並ぶ（design.md §4.12）
      "contactor-generic-3p-1a1b",
    ]);
    // タイマーは電気的にはリレーだが、パレットのカテゴリは分けている
    // （design.md §5.13）。`category` で絞ると relay 側には出てこない
    expect(listComponentDefinitions("timer").map((d) => d.id)).toEqual([
      "timer-on-delay",
      "timer-off-delay",
    ]);
    /*
     * 調光ランプは `category: "lamp"` のまま（design.md §5.17）。
     * ランプであって別種の部品ではなく、`dimming` を持つかどうかだけが違う
     * —— タイマーが `relay` のまま `category` だけ分かれているのとは逆で、
     * こちらは見た目もランプなのでカテゴリを分ける理由が無い
     */
    expect(listComponentDefinitions("lamp").map((d) => d.id)).toEqual([
      "lamp-dc24v",
      "lamp-ac100v",
      "lamp-dimmable-ac100v",
    ]);
    // 調光出力だけが独立したカテゴリ。電気的にも `analog-source` で別
    expect(listComponentDefinitions("dimmer").map((d) => d.id)).toEqual([
      "dimmer-0-10v",
      "dimming-controller-16ch",
      "dimmer-phase-control-ac100v",
      /*
       * **電気的にはリレー／スイッチだが、探す場所は調光**（design.md §4.16）。
       * MY4N を探している人のリレー一覧に調光の機器を混ぜない。
       */
      "light-controller-4ch",
      "dimming-console",
    ]);
    expect(listComponentDefinitions()).toHaveLength(24);
  });

  it("全定義が端子データの出典を持つ", () => {
    for (const definition of componentDefinitions) {
      expect(definition.source, definition.id).toBeTruthy();
    }
  });

  /**
   * 実端子番号を持たない汎用部品は検証対象そのものが存在しないので、
   * 検証済みを名乗ってはいけない（design.md §4.4 / §4.5）。
   *
   * 逆向き（実端子番号を持つ ⇒ `verified: true`）は**主張しない**。
   * 新しい型番は `verified: false` から始めるのが正しい手順で、
   * そこを縛ると未検証の型番を足せなくなる（CLAUDE.md 設計原則 5）。
   */
  it("実端子番号を持たない定義は検証済みを名乗らない", () => {
    for (const definition of componentDefinitions) {
      const hasRealNumbers = definition.terminals.some(
        (t) => t.number !== undefined,
      );
      if (hasRealNumbers) continue;
      expect(definition.verified, definition.id).toBe(false);
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
          : electrical.kind === "switch"
            ? [electrical.terminalA, electrical.terminalB]
            : electrical.kind === "lamp"
              ? [
                  electrical.terminalA,
                  electrical.terminalB,
                  // 調光ランプだけが持つ 2 端子（design.md §5.17）
                  ...(electrical.dimming
                    ? [
                        electrical.dimming.signalTerminal,
                        electrical.dimming.commonTerminal,
                      ]
                    : []),
                ]
              : electrical.kind === "diode"
                ? [electrical.anodeTerminal, electrical.cathodeTerminal]
                : electrical.kind === "terminal"
                  ? electrical.terminals
                  : electrical.kind === "analog-source"
                    ? [
                        ...electrical.channels.map((c) => c.signalTerminal),
                        ...electrical.commonTerminals,
                      ]
                    : electrical.kind === "dimmer"
                      ? [
                          electrical.inTerminal,
                          electrical.outTerminal,
                          electrical.acCommonTerminal,
                          electrical.signalTerminal,
                          electrical.signalCommonTerminal,
                          electrical.cutoffTerminal,
                        ]
                      : [
                        // コイルの無い機器（カットリレー・操作卓）もある（§4.16）
                        ...(electrical.relay.coil
                          ? [
                              electrical.relay.coil.positiveTerminal,
                              electrical.relay.coil.negativeTerminal,
                            ]
                          : []),
                        // 調光入力を持つ機器はその端子も参照する
                        ...(electrical.relay.analogInputs ?? []).flatMap(
                          (input) => [input.signalTerminal, input.commonTerminal],
                        ),
                        // NC 端子は a 接点のみのリレーには存在しない。
                        // 未定義を混ぜると「実在しない端子を参照している」判定になる
                        ...electrical.relay.contacts.flatMap((c) =>
                          [c.commonTerminal, c.noTerminal, c.ncTerminal].filter(
                            (id): id is string => id !== undefined,
                          ),
                        ),
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

  // 13 = (−) / 14 = (+) は公式データシート J199 p.1 の Coil Polarity「Type 1」。
  // 表示灯が逆並列 LED なので極性は none（design.md §4.4）
  it("コイルは 14 が (+)、13 が (−) で、極性は none", () => {
    if (my4n.electrical.kind !== "relay") throw new Error("relay ではない");
    expect(my4n.electrical.relay.coil).toMatchObject({
      voltage: 24,
      currentType: "DC",
      positiveTerminal: "14",
      negativeTerminal: "13",
      polarity: "none",
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

  it("実端子番号は公式データシートで検証済み", () => {
    expect(my4n.verified).toBe(true);
    // 出典は OMRON 公式ドメインでなければならない。
    // 二次資料に差し替わったまま verified: true が残るのを防ぐ（design.md §4.4）
    expect(my4n.source).toMatch(/^https:\/\/[\w.-]*omron\.(eu|com)\//);
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

  it("コイルは MY4N と同じ 14 = (+) / 13 = (−) で極性は none", () => {
    if (my2n.electrical.kind !== "relay") throw new Error("relay ではない");
    expect(my2n.electrical.relay.coil).toMatchObject({
      positiveTerminal: "14",
      negativeTerminal: "13",
      polarity: "none",
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
    const d2Coil = d2.electrical.relay.coil;
    const my4nCoil = my4n.electrical.relay.coil;
    if (!d2Coil || !my4nCoil) throw new Error("コイルを持つはず");
    expect(d2Coil.polarity).toBe("strict");
    expect(my4nCoil.polarity).toBe("none");
    expect({ ...d2Coil, polarity: null }).toEqual({
      ...my4nCoil,
      polarity: null,
    });
  });

  it("コイル端子の説明にダイオード内蔵を明記する", () => {
    expect(d2.terminals.find((t) => t.id === "14")?.description).toContain(
      "ダイオード内蔵",
    );
  });
});

describe("OMRON G7L-□A-B DC24V の端子データ（design.md §4.8）", () => {
  const g7l1a = requireComponentDefinition("omron-g7l-1a-b-dc24");
  const g7l2a = requireComponentDefinition("omron-g7l-2a-b-dc24");

  const relayOf = (definition: typeof g7l1a) => {
    if (definition.electrical.kind !== "relay") throw new Error("relay ではない");
    return definition.electrical.relay;
  };

  it("2 極形の端子番号が 0・1・2・4・6・8 で並ぶ", () => {
    expect(g7l2a.terminals.map((t) => t.number)).toEqual([
      "0",
      "1",
      "2",
      "4",
      "6",
      "8",
    ]);
  });

  /**
   * **本アプリの価値の中核。** カタログ p.8 の 1 極形の図は接点端子を
   * **4 と 6** に振っており、2 極形の 2 と 8 が欠番になる。
   * 2–4 に詰め直すと実機と違う番号を教えることになる（design.md §4.8）。
   */
  it("1 極形の端子番号は 0・1・4・6 の飛び番のまま（2 と 8 が欠番）", () => {
    expect(g7l1a.terminals.map((t) => t.number)).toEqual(["0", "1", "4", "6"]);
  });

  it("接点は a 接点のみで、NC 端子を持たない", () => {
    expect(relayOf(g7l2a).contacts).toEqual([
      { id: "c1", commonTerminal: "2", noTerminal: "4", type: "SPST-NO" },
      { id: "c2", commonTerminal: "6", noTerminal: "8", type: "SPST-NO" },
    ]);
    expect(relayOf(g7l1a).contacts).toEqual([
      { id: "c1", commonTerminal: "4", noTerminal: "6", type: "SPST-NO" },
    ]);
    for (const contact of [
      ...relayOf(g7l1a).contacts,
      ...relayOf(g7l2a).contacts,
    ]) {
      expect(contact.ncTerminal).toBeUndefined();
    }
  });

  /**
   * カタログ p.8 に「（コイル極性はありません）」と明記され、
   * p.12 のコイル内部接続図でも直流操作コイルは 0–1 間が素のコイルだけ。
   * MY シリーズのように `+` / `−` を名乗らせない（design.md §4.8）。
   */
  it("コイルは 0・1 で極性を持たず、端子の役割も +/− を名乗らない", () => {
    for (const definition of [g7l1a, g7l2a]) {
      expect(relayOf(definition).coil).toMatchObject({
        voltage: 24,
        currentType: "DC",
        polarity: "none",
      });
      const coilTerminals = definition.terminals.filter((t) =>
        ["0", "1"].includes(t.id),
      );
      expect(coilTerminals.map((t) => t.role)).toEqual(["coil", "coil"]);
      for (const terminal of coilTerminals) {
        expect(terminal.description).toContain("極性なし");
      }
    }
  });

  /**
   * 接点の 2 端子は対等な a 接点で、実機に COM は無い。
   * `commonTerminal` は `RelayContact` の形に合わせた並びの規約でしかないので、
   * 端子の `role` まで COM を名乗らせない（design.md §4.8）。
   */
  it("接点端子はどちらも a 接点として扱い、COM を名乗らない", () => {
    const contactTerminals = g7l2a.terminals.filter(
      (t) => t.contactGroup !== undefined,
    );
    expect(contactTerminals.map((t) => [t.id, t.role, t.contactGroup])).toEqual([
      ["2", "normally_open", "c1"],
      ["4", "normally_open", "c1"],
      ["6", "normally_open", "c2"],
      ["8", "normally_open", "c2"],
    ]);
  });

  it("1 極形と 2 極形の差は接点行だけ", () => {
    expect(relayOf(g7l1a).coil).toEqual(relayOf(g7l2a).coil);
    expect(g7l1a.manufacturer).toBe(g7l2a.manufacturer);
    expect(g7l1a.source).toBe(g7l2a.source);
  });

  it("実端子番号は公式カタログで検証済み", () => {
    for (const definition of [g7l1a, g7l2a]) {
      expect(definition.verified, definition.id).toBe(true);
      // 出典にカタログ番号と図の位置が残っていること。
      // 「オムロンのどこか」に薄まると再検証できなくなる（design.md §4.9）
      expect(definition.source).toContain("CDPA-041C");
      expect(definition.source).toContain("p.8");
    }
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
