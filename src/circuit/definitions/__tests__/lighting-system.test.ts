import { describe, expect, it } from "vitest";

import {
  componentRegistry,
  dimmingController16ch,
  phaseControlDimmer,
} from "@/circuit/definitions";
import { simulate } from "@/circuit/engine";
import type {
  CircuitComponentInstance,
  CircuitConnection,
  CircuitDocument,
  DimmerSettings,
  SimulationResult,
} from "@/circuit/types";

/**
 * 実機の調光システムの機器を配線して動かす検証（design.md §4.15）。
 *
 * 押さえたいのは 4 点。
 *
 * 1. **16 回路が独立して効く。** 回路ごとに違う電圧を出せなければ、
 *    フェーダー 1 と 2 を別々に動かす実機の使い方が再現できない
 * 2. **GND が機器の中で繋がっている。** 21 に繋いだ機器と 45 に繋いだ機器で
 *    基準が食い違ったら、正しい配線が「成立しない」と出てしまう
 * 3. **調光器は自分が点らず、通した先を暗くする。** 遮断と DIRECT が
 *    ネットの形ではなくレベルで効く
 * 4. **極性・上下限・カーブは盤ごとの設定。** 同じ機器を別々に設定して
 *    置ける（実機の DIP と可変抵抗）
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

const step = (document: CircuitDocument): SimulationResult =>
  simulate(document, componentRegistry, { pressedSwitches: new Set() });

const AC = "power-ac100v";
const LAMP = "lamp-ac100v";
const DIM_LAMP = "lamp-dimmable-ac100v";
const CONTROLLER = "dimming-controller-16ch";
const AC_DIMMER = "dimmer-phase-control-ac100v";

/** 回路ごとの電圧を指定したコントローラ */
const controller = (
  id: string,
  channelVolts: Record<string, number>,
): CircuitComponentInstance => ({
  id,
  definitionId: CONTROLLER,
  label: id,
  position: { x: 0, y: 0 },
  channelVolts,
});

/** 盤ごとの設定を持たせた調光器 */
const dimmer = (
  id: string,
  dimmerSettings?: DimmerSettings,
): CircuitComponentInstance => ({
  id,
  definitionId: AC_DIMMER,
  label: id,
  position: { x: 0, y: 0 },
  ...(dimmerSettings ? { dimmerSettings } : {}),
});

describe("端子データ（社内仕様書と照合）", () => {
  it("調光コントローラは 46 端子を実端子番号で持つ", () => {
    const ids = dimmingController16ch.terminals.map((t) => t.id);
    expect(ids).toHaveLength(46);
    // 0–10V 出力 1–16
    for (let i = 1; i <= 16; i += 1) expect(ids).toContain(String(i));
    // 未接続 17–20・GND 21・通信 22/23
    for (const id of ["17", "18", "19", "20", "21", "22", "23"]) {
      expect(ids).toContain(id);
    }
    // ON/OFF 出力 24–39・還流ダイオード 40/41・フォトカプラ 42/43・GND 44–46
    for (let i = 24; i <= 46; i += 1) expect(ids).toContain(String(i));
  });

  it("調光器は IN / COM / OUT と CN / GND / OFF を持つ", () => {
    expect(phaseControlDimmer.terminals.map((t) => t.id)).toEqual([
      "IN",
      "COM",
      "OUT",
      "CN",
      "GND",
      "OFF",
    ]);
  });

  /**
   * 社内仕様書を一次資料として読み写したので `verified: true`。
   * **型番を伏せたぶん、資料の版と日付を出典に残す**（CLAUDE.md 設計原則 5）。
   */
  it("出典に資料の版と日付が残り、型番は伏せてある", () => {
    for (const definition of [dimmingController16ch, phaseControlDimmer]) {
      expect(definition.verified).toBe(true);
      expect(definition.source).toMatch(/社内仕様書/);
      expect(definition.source).toMatch(/伏せ/);
      // 型番・製造元がリポジトリに漏れていない
      expect(`${definition.model} ${definition.source}`).not.toMatch(
        /FMD|FDR|ファンテックス/i,
      );
    }
  });

  /**
   * 使う端子だけ繋ぐ機器。46 端子すべての未接続を挙げると、
   * 本当に挿し忘れている 1 本が埋もれる（design.md §3.1 の `optional`）。
   */
  it("コントローラの端子は未接続でも警告しない", () => {
    const result = step(circuit([["C1", CONTROLLER]], []));
    expect(
      result.warnings.filter((w) => w.code === "unconnected-terminal"),
    ).toEqual([]);
  });

  /**
   * **調光信号だけは例外。** 挿し忘れると（逆特性では）全灯するので、
   * 指摘されないと気付けない。`optional` を立ててはいけない端子。
   */
  it("調光器の CN / GND は未接続なら指摘される", () => {
    const result = step(circuit([["D1", AC_DIMMER]], []));
    const unconnected = result.warnings
      .filter((w) => w.code === "unconnected-terminal")
      .map((w) => w.terminalId);
    expect(unconnected).toContain("CN");
    expect(unconnected).toContain("GND");
    // 遮断は使わない盤が普通なので、こちらは指摘しない
    expect(unconnected).not.toContain("OFF");
  });
});

describe("US-AO 調光コントローラの 16 回路", () => {
  // 回路 1 と 2 に別のランプを繋ぎ、GND は別々の端子（21 と 45）から取る
  const document = circuit(
    [["PS", AC], controller("C1", { "1": 0, "2": 10 }), ["L1", DIM_LAMP], ["L2", DIM_LAMP]],
    [
      wire("PS:L", "L1:1"),
      wire("PS:N", "L1:2"),
      wire("PS:L", "L2:1"),
      wire("PS:N", "L2:2"),
      wire("C1:1", "L1:DIM+"),
      wire("C1:21", "L1:DIM-"),
      wire("C1:2", "L2:DIM+"),
      // **わざと別の GND 端子から取る。** 機器の中で繋がっていなければ
      // ここで基準が食い違い、L2 が成立しなくなる
      wire("C1:45", "L2:DIM-"),
    ],
  );

  it("回路ごとに違う電圧を出せる", () => {
    const result = step(document);
    // 逆特性なので 0V が 100%、10V が 0%
    expect(result.analog.levelOf.get("L1")?.volts).toBe(0);
    expect(result.analog.levelOf.get("L1")?.percent).toBe(100);
    expect(result.analog.levelOf.get("L2")?.volts).toBe(10);
    expect(result.analog.levelOf.get("L2")?.percent).toBe(0);
  });

  /** GND 21・44・45・46 は機器の中で繋がっている（仕様書どおり） */
  it("どの GND 端子から取っても基準が成立する", () => {
    const result = step(document);
    expect(result.analog.levelOf.get("L2")?.referenceMismatch).toBe(false);
    expect(result.netOf.get("C1:21")).toBe(result.netOf.get("C1:45"));
  });

  /** 設定しなかった回路は定義の既定値（消灯側の 10V） */
  it("設定していない回路は既定の 10V を出す", () => {
    const bare = circuit(
      [["PS", AC], ["C1", CONTROLLER], ["L1", DIM_LAMP]],
      [
        wire("PS:L", "L1:1"),
        wire("PS:N", "L1:2"),
        wire("C1:9", "L1:DIM+"),
        wire("C1:21", "L1:DIM-"),
      ],
    );
    const result = step(bare);
    expect(result.analog.levelOf.get("L1")?.volts).toBe(10);
    expect(result.analog.levelOf.get("L1")?.percent).toBe(0);
  });
});

describe("US-AP 位相制御調光器", () => {
  /** AC → 調光器 → ランプ。調光信号はコントローラの回路 1 から */
  const panel = (
    volts: number,
    settings?: DimmerSettings,
    extra: CircuitConnection[] = [],
  ) =>
    circuit(
      [["PS", AC], controller("C1", { "1": volts }), dimmer("D1", settings), ["L1", LAMP]],
      [
        wire("PS:L", "D1:IN"),
        wire("PS:N", "D1:COM"),
        wire("D1:OUT", "L1:1"),
        wire("PS:N", "L1:2"),
        wire("C1:1", "D1:CN"),
        wire("C1:21", "D1:GND"),
        ...extra,
      ],
    );

  it("AC を通すので、出力回路のランプに電源が届く", () => {
    const result = step(panel(0));
    expect([...result.litLamps]).toEqual(["L1"]);
    /*
     * **IN と OUT は別のネットのまま。** union してしまうと、同じ電源から
     * 取った 2 台の調光器の出力回路が 1 つに融合する（下の「同じ機器を
     * 別々の設定で置ける」がそれを押さえている）。電位だけが流れる
     */
    expect(result.netOf.get("D1:IN")).not.toBe(result.netOf.get("D1:OUT"));
  });

  it("調光信号の電圧で出力回路の明るさが決まる", () => {
    // 逆特性：0V で 100%、10V で 0%、5V で 50%
    expect(step(panel(0)).analog.levelOf.get("L1")?.percent).toBe(100);
    expect(step(panel(10)).analog.levelOf.get("L1")?.percent).toBe(0);
    expect(step(panel(5)).analog.levelOf.get("L1")?.percent).toBe(50);
  });

  /**
   * **遮断は最優先。** 実機の強制出力遮断は調光段より後ろで切っているので、
   * 信号が何 V でも・DIRECT でも戻らない。
   */
  it("OFF を GND へ落とすと出力が遮断される", () => {
    const cut = panel(0, undefined, [wire("D1:OFF", "D1:GND")]);
    const level = step(cut).analog.levelOf.get("D1");
    expect(level?.cutOff).toBe(true);
    expect(level?.percent).toBe(0);
    expect(step(cut).analog.levelOf.get("L1")?.percent).toBe(0);
  });

  it("DIRECT でも遮断が勝つ", () => {
    const cut = panel(10, { direct: true }, [wire("D1:OFF", "D1:GND")]);
    expect(step(cut).analog.levelOf.get("L1")?.percent).toBe(0);
  });

  /** **この配線が電源短絡として警告されない**（アナログは導通レイヤの外） */
  it("遮断の配線が電源短絡にならない", () => {
    const cut = panel(0, undefined, [wire("D1:OFF", "D1:GND")]);
    expect(
      step(cut).warnings.filter((w) => w.code === "power-short-circuit"),
    ).toEqual([]);
  });

  it("調光信号が未接続なら定義の未接続時レベル（＝全灯）になる", () => {
    const floating = circuit(
      [["PS", AC], dimmer("D1"), ["L1", LAMP]],
      [
        wire("PS:L", "D1:IN"),
        wire("PS:N", "D1:COM"),
        wire("D1:OUT", "L1:1"),
        wire("PS:N", "L1:2"),
      ],
    );
    const level = step(floating).analog.levelOf.get("D1");
    expect(level?.floating).toBe(true);
    expect(level?.percent).toBe(100);
  });

  /** 調光器は自分が点る負荷ではない。通り道なので `litLamps` に入らない */
  it("調光器そのものは点灯しない", () => {
    expect([...step(panel(0)).litLamps]).not.toContain("D1");
  });
});

describe("US-AQ 極性・上下限・カーブは盤ごとの設定", () => {
  const withSettings = (volts: number, settings: DimmerSettings) =>
    circuit(
      [["PS", AC], controller("C1", { "1": volts }), dimmer("D1", settings), ["L1", LAMP]],
      [
        wire("PS:L", "D1:IN"),
        wire("PS:N", "D1:COM"),
        wire("D1:OUT", "L1:1"),
        wire("PS:N", "L1:2"),
        wire("C1:1", "D1:CN"),
        wire("C1:21", "D1:GND"),
      ],
    );

  const percentAt = (volts: number, settings: DimmerSettings) =>
    step(withSettings(volts, settings)).analog.levelOf.get("L1")?.percent;

  /**
   * **極性は実機の DIP で切り替わる。** 0V = 100% は「この盤の設定」で
   * あって機器の仕様ではない。反転すると順特性の機器として使える。
   */
  it("極性を反転すると 0V が 0%、10V が 100% になる", () => {
    expect(percentAt(0, { inverted: true })).toBe(0);
    expect(percentAt(10, { inverted: true })).toBe(100);
  });

  it("調光上限（100/90/80/70%）が効く", () => {
    expect(percentAt(0, { maxPercent: 70 })).toBe(70);
    expect(percentAt(0, { maxPercent: 90 })).toBe(90);
    // 上限より暗い指示はそのまま通る
    expect(percentAt(8, { maxPercent: 70 })).toBe(20);
  });

  it("調光下限（0〜50%）が効く", () => {
    // 10V＝0% の指示でも下限まで
    expect(percentAt(10, { minPercent: 30 })).toBe(30);
    expect(percentAt(0, { minPercent: 30 })).toBe(100);
  });

  /** 2 乗特性。低いほうが緩やかに効く */
  it("カーブを 2 乗特性にすると中間が暗くなる", () => {
    expect(percentAt(5, { curveShape: "linear" })).toBe(50);
    expect(percentAt(5, { curveShape: "square" })).toBe(25);
    // 両端は変わらない
    expect(percentAt(0, { curveShape: "square" })).toBe(100);
    expect(percentAt(10, { curveShape: "square" })).toBe(0);
  });

  /**
   * **DIRECT は上限すら飛び越える。** 実機の直点は調光段を通さないので、
   * 先に丸めると「DIRECT にしたのに 70% までしか上がらない」という嘘になる。
   */
  it("DIRECT は上限設定を飛び越えて 100% になる", () => {
    expect(percentAt(10, { direct: true, maxPercent: 70 })).toBe(100);
  });

  /** 同じ機器を盤の中で別々に設定して置ける（インスタンスごとの値） */
  it("同じ機器を別々の設定で置ける", () => {
    const document = circuit(
      [
        ["PS", AC],
        controller("C1", { "1": 0 }),
        dimmer("D1", { maxPercent: 70 }),
        dimmer("D2"),
        ["L1", LAMP],
        ["L2", LAMP],
      ],
      [
        wire("PS:L", "D1:IN"),
        wire("PS:N", "D1:COM"),
        wire("D1:OUT", "L1:1"),
        wire("PS:N", "L1:2"),
        wire("PS:L", "D2:IN"),
        wire("PS:N", "D2:COM"),
        wire("D2:OUT", "L2:1"),
        wire("PS:N", "L2:2"),
        wire("C1:1", "D1:CN"),
        wire("C1:21", "D1:GND"),
        wire("C1:1", "D2:CN"),
        wire("C1:21", "D2:GND"),
      ],
    );
    const result = step(document);
    expect(result.analog.levelOf.get("L1")?.percent).toBe(70);
    expect(result.analog.levelOf.get("L2")?.percent).toBe(100);
  });
});
