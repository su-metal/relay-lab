import { describe, expect, it } from "vitest";

import { inspectContacts } from "@/circuit/adapter/inspection";
import {
  componentRegistry,
  genericContactor,
  requireComponentDefinition,
} from "@/circuit/definitions";
import { simulate } from "@/circuit/engine";
import type {
  CircuitConnection,
  CircuitDocument,
  SimulationResult,
} from "@/circuit/types";
import { contactSummaryOf } from "@/lib/component-display";

/**
 * 電磁接触器と AC 電源を実際に配線して動かす検証（design.md §4.12・§4.13）。
 *
 * 押さえたいのは 3 点。
 *
 * 1. **b 接点だけの補助接点が、励磁するとどこにも閉じない。** a 接点で
 *    `ncTerminal` を省いたときの裏返し。ここで COM が NO 側へ倒れたことに
 *    なると、**実機に無い a 接点が生える**（design.md §5.1）
 * 2. **主接点 3 極と補助 a 接点が、コイル 1 個で同時に動く。** 極ごとに
 *    ずれたら接点を 1 つのリレーとしてまとめられていない
 * 3. **AC 電源が DC と同じ規則で判定される。** 交流に + と 0V は無いが、
 *    エンジンから見れば「同じ 1 台の電源の両端に届くか」は変わらない
 *
 * `engine/__tests__/` には置かない。検証対象は定義データであってエンジン
 * ではない（design.md §4.6）。**このスコープでエンジンの差分は 0 行**。
 */

/** "MC1:A1" のような "インスタンスID:端子ID" 記法で配線する */
const wire = (from: string, to: string): CircuitConnection => {
  const [fromComponent, fromTerminal] = from.split(":");
  const [toComponent, toTerminal] = to.split(":");
  return {
    id: `${from}-${to}`,
    from: { componentId: fromComponent, terminalId: fromTerminal },
    to: { componentId: toComponent, terminalId: toTerminal },
  };
};

const circuit = (
  components: Record<string, string>,
  connections: CircuitConnection[],
): CircuitDocument => ({
  version: 1,
  components: Object.entries(components).map(([id, definitionId]) => ({
    id,
    definitionId,
    label: id,
    position: { x: 0, y: 0 },
  })),
  connections,
  viewport: { x: 0, y: 0, zoom: 1 },
});

const step = (
  document: CircuitDocument,
  pressed: string[] = [],
): SimulationResult =>
  simulate(document, componentRegistry, {
    pressedSwitches: new Set(pressed),
  });

/** 同じネットに乗っているか（＝その 2 端子が導通しているか） */
const conducts = (result: SimulationResult, a: string, b: string): boolean =>
  result.netOf.get(a) !== undefined && result.netOf.get(a) === result.netOf.get(b);

const AC100V = "power-ac100v";
const DC24V = "power-dc24v";
const PB_NO = "switch-pushbutton-no";
const LAMP = "lamp-dc24v";
const MC = "contactor-generic-3p-1a1b";

describe("汎用電磁接触器の端子構成（design.md §4.12）", () => {
  it("IEC の端子記号で 12 端子を持つ", () => {
    expect(genericContactor.terminals.map((t) => t.id)).toEqual([
      "1/L1",
      "2/T1",
      "3/L2",
      "4/T2",
      "5/L3",
      "6/T3",
      "13",
      "14",
      "21",
      "22",
      "A1",
      "A2",
    ]);
  });

  /**
   * **接点の形の混在を "5c" に丸めない。** 主接点 3 極と補助 a 接点は
   * a 接点、補助 b 接点は b 接点で、切替接点は 1 つも無い。
   */
  it("接点構成は 4a1b と表示される", () => {
    const electrical = genericContactor.electrical;
    if (electrical.kind !== "relay") throw new Error("relay ではない");
    expect(contactSummaryOf(electrical.relay)).toBe("4a1b");
  });

  /**
   * 実端子番号を主張する以上、出典が要る（CLAUDE.md 設計原則 5）。
   * IEC の記号ではあるが特定型番のカタログとは未照合なので `verified: false`。
   */
  it("出典を持ち、検証済みを名乗らない", () => {
    expect(genericContactor.source).toMatch(/IEC 60947/);
    expect(genericContactor.verified).toBe(false);
  });

  /** 電気的にはリレー。`kind` を分けない（CLAUDE.md 設計原則 7） */
  it("電気的にはリレーで、カテゴリもリレーのまま", () => {
    expect(genericContactor.electrical.kind).toBe("relay");
    expect(genericContactor.category).toBe("relay");
  });
});

describe("AC100V で電磁接触器を動かす（design.md §4.12・§4.13）", () => {
  // L → S1 → A1 / A2 → N でコイルを操作し、主接点 1 極で AC 負荷を入り切りする。
  // ランプの定格は DC24V だが、定格不一致は判定しない（design.md §6-3）
  const document = circuit(
    { PS1: AC100V, S1: PB_NO, MC1: MC, L1: LAMP },
    [
      wire("PS1:L", "S1:1"),
      wire("S1:2", "MC1:A1"),
      wire("MC1:A2", "PS1:N"),
      wire("PS1:L", "MC1:1/L1"),
      wire("MC1:2/T1", "L1:1"),
      wire("L1:2", "PS1:N"),
    ],
  );

  it("非励磁では主接点が開き、負荷に電気が行かない", () => {
    const result = step(document);

    expect(result.status).toBe("stable");
    expect([...result.energizedRelays]).toEqual([]);
    expect(conducts(result, "MC1:1/L1", "MC1:2/T1")).toBe(false);
    expect([...result.litLamps]).toEqual([]);
  });

  it("コイルが励磁すると主接点が閉じ、負荷が動く", () => {
    const result = step(document, ["S1"]);

    expect(result.status).toBe("stable");
    expect([...result.energizedRelays]).toEqual(["MC1"]);
    expect(conducts(result, "MC1:1/L1", "MC1:2/T1")).toBe(true);
    expect([...result.litLamps]).toEqual(["L1"]);
  });

  /**
   * 交流操作コイルに極性は無い。A1 / A2 を入れ替えても励磁し、
   * 極性の警告も出ない（G7L と同じ・design.md §4.8）。
   */
  it("コイルを逆向きに繋いでも励磁し、極性の警告は出ない", () => {
    const reversed = circuit({ PS1: AC100V, S1: PB_NO, MC1: MC }, [
      wire("PS1:L", "S1:1"),
      // A2 を L 側、A1 を N 側にする（上の回路と逆）
      wire("S1:2", "MC1:A2"),
      wire("MC1:A1", "PS1:N"),
    ]);
    const result = step(reversed, ["S1"]);

    expect([...result.energizedRelays]).toEqual(["MC1"]);
    expect(
      result.warnings.filter((w) => w.code === "coil-polarity-reversed"),
    ).toEqual([]);
  });
});

describe("補助 b 接点（21–22）は NO 端子を持たない（design.md §4.12）", () => {
  // コイルを操作しつつ、21–22 に負荷をぶら下げて開閉を読む
  const document = circuit(
    { PS1: AC100V, S1: PB_NO, MC1: MC, L1: LAMP, L2: LAMP },
    [
      wire("PS1:L", "S1:1"),
      wire("S1:2", "MC1:A1"),
      wire("MC1:A2", "PS1:N"),
      // 補助 b 接点の先のランプ（非励磁で点く）
      wire("PS1:L", "MC1:21"),
      wire("MC1:22", "L1:1"),
      wire("L1:2", "PS1:N"),
      // 補助 a 接点の先のランプ（励磁で点く）
      wire("PS1:L", "MC1:13"),
      wire("MC1:14", "L2:1"),
      wire("L2:2", "PS1:N"),
    ],
  );

  it("非励磁では 21–22 が閉じ、13–14 は開いている", () => {
    const result = step(document);

    expect(conducts(result, "MC1:21", "MC1:22")).toBe(true);
    expect(conducts(result, "MC1:13", "MC1:14")).toBe(false);
    expect([...result.litLamps]).toEqual(["L1"]);
  });

  /**
   * **本ファイルの主眼。** 励磁すると 21 は「どこにも繋がらない」。
   * c 接点の「COM は必ずどちらかへ倒れる」を当てはめると、
   * 実機に無い a 接点側へ倒れたことになってしまう。
   */
  it("励磁すると 21 はどこにも閉じず、13–14 だけが閉じる", () => {
    const result = step(document, ["S1"]);

    expect(conducts(result, "MC1:21", "MC1:22")).toBe(false);
    expect(conducts(result, "MC1:13", "MC1:14")).toBe(true);
    expect([...result.litLamps]).toEqual(["L2"]);
  });

  /**
   * 図記号・プロパティパネルが読む `inspectContacts()` の回帰テスト。
   *
   * **`undefined` の突き合わせで "no" に化けやすい。** 励磁中の b 接点は
   * 閉じている相手が `undefined`、`noTerminal` も `undefined` なので、
   * 素直に `other === contact.noTerminal` を先に見ると一致してしまい、
   * **実機に無い a 接点が閉じている絵**になる（adapter/inspection.ts）。
   */
  it("励磁中の b 接点は open であって no ではない", () => {
    const definition = requireComponentDefinition(MC);
    if (definition.electrical.kind !== "relay") throw new Error("relay ではない");
    const { relay } = definition.electrical;

    const off = inspectContacts(relay, false);
    const on = inspectContacts(relay, true);
    const sideOf = (list: ReturnType<typeof inspectContacts>, id: string) =>
      list.find((entry) => entry.contact.id === id)?.closed;

    // 補助 b 接点（c5）
    expect(sideOf(off, "c5")).toBe("nc");
    expect(sideOf(on, "c5")).toBe("open");
    // 補助 a 接点（c4）は裏返し
    expect(sideOf(off, "c4")).toBe("open");
    expect(sideOf(on, "c4")).toBe("no");
  });
});

describe("互いの b 接点で縛るインターロック（design.md §4.12）", () => {
  // MC1 のコイルは MC2 の 21–22 を通り、MC2 のコイルは MC1 の 21–22 を通る
  const document = circuit(
    { PS1: AC100V, S1: PB_NO, S2: PB_NO, MC1: MC, MC2: MC },
    [
      wire("PS1:L", "S1:1"),
      wire("S1:2", "MC2:21"),
      wire("MC2:22", "MC1:A1"),
      wire("MC1:A2", "PS1:N"),
      wire("PS1:L", "S2:1"),
      wire("S2:2", "MC1:21"),
      wire("MC1:22", "MC2:A1"),
      wire("MC2:A2", "PS1:N"),
    ],
  );

  it("片方を押すと、その 1 台だけが励磁する", () => {
    expect([...step(document, ["S1"]).energizedRelays]).toEqual(["MC1"]);
    expect([...step(document, ["S2"]).energizedRelays]).toEqual(["MC2"]);
  });

  /**
   * 全 OFF から同時に押した場合は勝敗が付かない。
   * 動作時間を持たない以上、どちらが勝つかを決める根拠が無い
   * （design.md §6-5 の既知の制約。実機では速い方が勝つ）。
   */
  it("全 OFF から同時に押すと収束しない（design.md §6-5）", () => {
    expect(step(document, ["S1", "S2"]).status).toBe("oscillating");
  });
});

describe("AC100V 電源そのもの（design.md §4.13）", () => {
  it("端子は L / N で、+ や 0V を名乗らない", () => {
    const definition = requireComponentDefinition(AC100V);
    expect(definition.terminals.map((t) => t.label)).toEqual(["L", "N"]);
    expect(definition.terminals.map((t) => t.role)).toEqual([
      "power_line",
      "power_neutral",
    ]);
    // 実端子番号ではないので `number` を持たない（design.md §4.5）
    expect(definition.terminals.every((t) => t.number === undefined)).toBe(true);
  });

  it("L と N を直結すると電源短絡として警告が出る", () => {
    const shorted = circuit({ PS1: AC100V }, [wire("PS1:L", "PS1:N")]);
    const codes = step(shorted).warnings.map((w) => w.code);

    expect(codes).toContain("power-short-circuit");
  });

  /**
   * **DC と AC をまたいだ負荷は通電しない。** 基準（0V / N）を共有して
   * いない 2 台の電源では実機でも帰り道が無い。ここが「通電」と出たら、
   * 0V コモンの繋ぎ忘れという実務で最も多い誤配線を、
   * 逆に「動きます」と答えてしまう（design.md §5.3）。
   */
  it("DC24V の + と AC100V の N をまたいだランプは点かない", () => {
    const mixed = circuit({ PS1: DC24V, PS2: AC100V, L1: LAMP }, [
      wire("PS1:plus", "L1:1"),
      wire("L1:2", "PS2:N"),
    ]);
    const result = step(mixed);

    expect([...result.litLamps]).toEqual([]);
    expect(result.status).toBe("stable");
  });
});
