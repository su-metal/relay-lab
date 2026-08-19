import { describe, expect, it } from "vitest";

import { inspectContacts } from "@/circuit/adapter/inspection";
import {
  componentRegistry,
  dimmingConsole,
  lightController4ch,
} from "@/circuit/definitions";
import { simulate } from "@/circuit/engine";
import type {
  CircuitComponentInstance,
  CircuitConnection,
  CircuitDocument,
  SimulationResult,
} from "@/circuit/types";
import { operationKey } from "@/circuit/types";

/**
 * 接点の駆動源がコイル以外にも広がったことの検証（design.md §4.16）。
 *
 * 押さえたいのは 3 点。
 *
 * 1. **アナログ量が接点を動かす。** 明るさが動作点を下回るとカットリレーが
 *    動作する。動作点は回路ごとに設定できる（実機の CUT ADJ.）
 * 2. **人の操作が接点を動かす。** 操作卓のボタンで無電圧接点とオープン
 *    コレクタ出力が倒れる
 * 3. **コイルの無い機器が既存の判定を壊さない。** 極性違反も未接続も出ず、
 *    ラダー図にも自己保持にも顔を出さない
 */

const wire = (from: string, to: string): CircuitConnection => {
  const [fc, ft] = from.split(":");
  const [tc, tt] = to.split(":");
  return {
    id: `${from}-${to}`,
    from: { componentId: fc, terminalId: ft },
    to: { componentId: tc, terminalId: tt },
  };
};

const circuit = (
  components: (CircuitComponentInstance | [string, string])[],
  connections: CircuitConnection[],
): CircuitDocument => ({
  version: 1,
  components: components.map((entry) =>
    Array.isArray(entry)
      ? {
          id: entry[0],
          definitionId: entry[1],
          label: entry[0],
          position: { x: 0, y: 0 },
        }
      : entry,
  ),
  connections,
  viewport: { x: 0, y: 0, zoom: 1 },
});

const step = (
  document: CircuitDocument,
  operated: string[] = [],
): SimulationResult =>
  simulate(document, componentRegistry, {
    pressedSwitches: new Set(),
    operatedDevices: new Set(operated),
  });

const conducts = (result: SimulationResult, a: string, b: string): boolean =>
  result.netOf.get(a) !== undefined && result.netOf.get(a) === result.netOf.get(b);

const AC = "power-ac100v";
const DC = "power-dc24v";
const LAMP = "lamp-dc24v";
const CONTROLLER = "dimming-controller-16ch";
const LIGHT_CTRL = "light-controller-4ch";
const CONSOLE = "dimming-console";

describe("US-AR カットリレーが明るさで動く", () => {
  /**
   * 調光コントローラの回路 1・2 をライトコントローラの入力 1・2 へ。
   * カットリレー接点で DC24V のランプを点ける。
   */
  const panel = (
    volts: Record<string, number>,
    triggerPercents?: Record<string, number>,
  ) =>
    circuit(
      [
        ["PSD", DC],
        {
          id: "C1",
          definitionId: CONTROLLER,
          label: "C1",
          position: { x: 0, y: 0 },
          channelVolts: volts,
        },
        {
          id: "LC",
          definitionId: LIGHT_CTRL,
          label: "LC",
          position: { x: 0, y: 0 },
          ...(triggerPercents ? { triggerPercents } : {}),
        },
        ["L1", LAMP],
        ["L2", LAMP],
      ],
      [
        wire("C1:1", "LC:IN1"),
        wire("C1:2", "LC:IN2"),
        wire("C1:3", "LC:IN3"),
        wire("C1:4", "LC:IN4"),
        wire("C1:21", "LC:ING"),
        wire("PSD:plus", "LC:CRG"),
        wire("LC:CR1", "L1:1"),
        wire("L1:2", "PSD:zero"),
        wire("LC:CR2", "L2:1"),
        wire("L2:2", "PSD:zero"),
      ],
    );

  /*
   * この盤は逆特性（0V = 100%）。既定の動作点は 25% なので、
   * 明るさ 25% 以下 ＝ 7.5V 以上で動作する。
   */
  it("明るさが動作点を下回ると接点が閉じる", () => {
    // 10V ＝ 0%（動作点 25% 以下）→ 動作
    expect(conducts(step(panel({ "1": 10 })), "LC:CRG", "LC:CR1")).toBe(true);
    // 0V ＝ 100% → 動作しない
    expect(conducts(step(panel({ "1": 0 })), "LC:CRG", "LC:CR1")).toBe(false);
  });

  it("動作したカットリレーの接点でランプが点く", () => {
    expect([...step(panel({ "1": 10, "2": 0 })).litLamps]).toEqual(["L1"]);
    expect([...step(panel({ "1": 0, "2": 10 })).litLamps]).toEqual(["L2"]);
  });

  /** 実機の CUT ADJ.（回路ごとのつまみ）。0〜50% で設定できる */
  it("動作点を回路ごとに設定できる", () => {
    // 5V ＝ 50%。既定の 25% では動作しないが、動作点を 50% に上げれば動作する
    expect(conducts(step(panel({ "1": 5 })), "LC:CRG", "LC:CR1")).toBe(false);
    expect(
      conducts(step(panel({ "1": 5 }, { c1: 50 })), "LC:CRG", "LC:CR1"),
    ).toBe(true);
    // 回路 2 の設定は回路 1 に影響しない
    const mixed = step(panel({ "1": 5, "2": 5 }, { c2: 50 }));
    expect(conducts(mixed, "LC:CRG", "LC:CR1")).toBe(false);
    expect(conducts(mixed, "LC:CRG", "LC:CR2")).toBe(true);
  });

  it("4 回路が独立して効く", () => {
    const result = step(panel({ "1": 10, "2": 0, "3": 10, "4": 0 }));
    expect(conducts(result, "LC:CRG", "LC:CR1")).toBe(true);
    expect(conducts(result, "LC:CRG", "LC:CR2")).toBe(false);
    expect(conducts(result, "LC:CRG", "LC:CR3")).toBe(true);
    expect(conducts(result, "LC:CRG", "LC:CR4")).toBe(false);
  });

  /**
   * **調光信号が未接続なら定義の未接続時レベル。** 逆特性のこの盤では
   * 100%（全灯）なので、カットリレーは動作しない。
   */
  it("調光信号が未接続なら全灯扱いで動作しない", () => {
    const bare = circuit([["PSD", DC], ["LC", LIGHT_CTRL]], []);
    expect(conducts(step(bare), "LC:CRG", "LC:CR1")).toBe(false);
  });
});

describe("US-AS 操作卓のボタンで接点が出る", () => {
  const POWER = operationKey("CP", "power");

  // 無電圧接点（4-5-6）とオープンコレクタ出力（9-2-3）にランプを繋ぐ
  const document = circuit(
    [["PSD", DC], ["CP", CONSOLE], ["L1", LAMP], ["L2", LAMP]],
    [
      wire("PSD:plus", "CP:5"),
      wire("CP:6", "L1:1"),
      wire("L1:2", "PSD:zero"),
      wire("PSD:plus", "CP:9"),
      wire("CP:2", "L2:1"),
      wire("L2:2", "PSD:zero"),
    ],
  );

  it("倒していなければ NC 側が閉じている", () => {
    const result = step(document);
    expect(conducts(result, "CP:5", "CP:4")).toBe(true);
    expect(conducts(result, "CP:5", "CP:6")).toBe(false);
    expect([...result.litLamps]).toEqual([]);
  });

  it("倒すと NO 側へ切り替わり、両方の接点が同時に動く", () => {
    const result = step(document, [POWER]);
    expect(conducts(result, "CP:5", "CP:6")).toBe(true);
    expect(conducts(result, "CP:5", "CP:4")).toBe(false);
    // オープンコレクタ出力も同じ操作で動く
    expect(conducts(result, "CP:9", "CP:2")).toBe(true);
    expect([...result.litLamps].sort()).toEqual(["L1", "L2"]);
  });

  /** 動作している接点は結果に出る。画面が図記号を描き分けるのに要る */
  it("動作している接点が結果に出る", () => {
    expect([...(step(document, [POWER]).operatedContacts.get("CP") ?? [])].sort()).toEqual(
      ["c1", "c2"],
    );
    expect(step(document).operatedContacts.get("CP")).toBeUndefined();
  });

  /** 図記号・プロパティパネルが読む `inspectContacts()` も同じ答えを出す */
  it("図記号も倒れた側を描く", () => {
    if (dimmingConsole.electrical.kind !== "relay") throw new Error("relay ではない");
    const { relay } = dimmingConsole.electrical;
    const off = inspectContacts(relay, false, undefined);
    const on = inspectContacts(relay, false, new Set(["c1", "c2"]));
    expect(off.map((entry) => entry.closed)).toEqual(["nc", "nc"]);
    expect(on.map((entry) => entry.closed)).toEqual(["no", "no"]);
  });
});

describe("US-AT コイルの無い機器が破綻しない", () => {
  it("コイルを持たない", () => {
    for (const definition of [lightController4ch, dimmingConsole]) {
      if (definition.electrical.kind !== "relay") throw new Error("relay ではない");
      expect(definition.electrical.relay.coil).toBeUndefined();
    }
  });

  /** 存在しないものは検査しない。極性違反もコイルの未接続も出ない */
  it("コイルの極性違反が出ない", () => {
    const document = circuit([["PSD", DC], ["LC", LIGHT_CTRL], ["CP", CONSOLE]], []);
    const codes = step(document).warnings.map((w) => w.code);
    expect(codes).not.toContain("coil-polarity-reversed");
    expect(codes).not.toContain("coil-self-interrupt");
  });

  it("既存のリレーの動きは変わらない", () => {
    // 自己保持：押しボタンで励磁し、自分の a 接点で保持する
    const document = circuit(
      [["PS", DC], ["S1", "switch-pushbutton-no"], ["RY", "omron-my4n-dc24"], ["L1", LAMP]],
      [
        wire("PS:plus", "S1:1"),
        wire("S1:2", "RY:14"),
        wire("RY:13", "PS:zero"),
        wire("PS:plus", "RY:9"),
        wire("RY:5", "RY:14"),
        wire("PS:plus", "RY:10"),
        wire("RY:6", "L1:1"),
        wire("L1:2", "PS:zero"),
      ],
    );
    const pressed = simulate(document, componentRegistry, {
      pressedSwitches: new Set(["S1"]),
    });
    expect([...pressed.energizedRelays]).toEqual(["RY"]);

    // 離しても保持し続ける（前回の励磁状態を渡す）
    const held = simulate(document, componentRegistry, {
      pressedSwitches: new Set(),
      previousEnergizedRelays: pressed.energizedRelays,
    });
    expect([...held.energizedRelays]).toEqual(["RY"]);
    expect([...held.litLamps]).toEqual(["L1"]);
  });

  /** 端子データは社内仕様書と照合済み。型番は漏らさない */
  it("出典が残り、型番は伏せてある", () => {
    for (const definition of [lightController4ch, dimmingConsole]) {
      expect(definition.verified).toBe(true);
      expect(definition.source).toMatch(/社内仕様書/);
      expect(`${definition.model} ${definition.source}`).not.toMatch(
        /FMD|FDR|ファンテックス/i,
      );
    }
  });
});

describe("アナログが接点を動かしても層は混ざらない", () => {
  /**
   * カットリレーが動いても、調光信号の線が電源短絡として警告されたり
   * 電源の 0V と混ざったりしない（CLAUDE.md 設計原則 9）。
   */
  it("調光信号が電源短絡にならない", () => {
    const document = circuit(
      [["PSD", DC], ["C1", CONTROLLER], ["LC", LIGHT_CTRL]],
      [
        wire("C1:1", "LC:IN1"),
        wire("C1:21", "LC:ING"),
        wire("PSD:zero", "C1:21"),
      ],
    );
    const result = step(document);
    expect(result.warnings.filter((w) => w.code === "power-short-circuit")).toEqual([]);
    expect(result.status).toBe("stable");
  });

  /** アナログを反復の中で解いても、調光を使わない回路の答えは変わらない */
  it("調光を使わない回路は今までどおり解ける", () => {
    const document = circuit(
      [["PS", AC], ["MC", "contactor-generic-3p-1a1b"], ["L1", LAMP]],
      [
        wire("PS:L", "MC:A1"),
        wire("MC:A2", "PS:N"),
        wire("PS:L", "MC:1/L1"),
        wire("MC:2/T1", "L1:1"),
        wire("L1:2", "PS:N"),
      ],
    );
    const result = step(document);
    expect([...result.energizedRelays]).toEqual(["MC"]);
    expect([...result.litLamps]).toEqual(["L1"]);
    expect(result.operatedContacts.size).toBe(0);
  });
});
