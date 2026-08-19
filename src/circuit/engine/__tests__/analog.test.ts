/**
 * 調光（0–10V のアナログ量）の検証（design.md §5.17・requirements.md US-AK〜AN）。
 *
 * **押さえどころは「導通レイヤに混ざっていないこと」。** 0V を出している
 * 調光信号線が電源短絡にならないこと・非通電に見えないこと・電源の 0V と
 * 混ざらないことを、色と警告の両側から確かめる。
 *
 * 逆特性（0V = 100%）は定義側の `AnalogCurve` にあり、エンジンは電圧しか
 * 読まない。**このファイルにも `if (model === ...)` は 1 つも無い。**
 */

import { describe, expect, it } from "vitest";

import { buildSimulationView } from "@/circuit/adapter/simulation-view";
import { buildWireRoles } from "@/circuit/adapter/wire-role";
import { componentRegistry } from "@/circuit/definitions";
import {
  analogPercent,
  inspectWiring,
  outputVoltsOf,
  simulate,
} from "@/circuit/engine";
import type {
  CircuitComponentInstance,
  CircuitConnection,
  CircuitDocument,
  SimulationResult,
} from "@/circuit/types";
import { terminalKey } from "@/circuit/types";

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
  components: Record<string, string | CircuitComponentInstance>,
  connections: CircuitConnection[],
): CircuitDocument => ({
  version: 1,
  components: Object.entries(components).map(([id, entry]) =>
    typeof entry === "string"
      ? { id, definitionId: entry, label: id, position: { x: 0, y: 0 } }
      : entry,
  ),
  connections,
  viewport: { x: 0, y: 0, zoom: 1 },
});

const run = (
  document: CircuitDocument,
  pressed: string[] = [],
): SimulationResult =>
  simulate(document, componentRegistry, { pressedSwitches: new Set(pressed) });

const AC = "power-ac100v";
const DC = "power-dc24v";
const PB_NO = "switch-pushbutton-no";
const RELAY = "omron-my4n-dc24";
const DIMMER = "dimmer-0-10v";
const DIM_LAMP = "lamp-dimmable-ac100v";

/** 出力電圧を指定した調光出力のインスタンス */
const dimmer = (id: string, volts: number): CircuitComponentInstance => ({
  id,
  definitionId: DIMMER,
  label: id,
  position: { x: 0, y: 0 },
  outputVolts: volts,
});

/**
 * AC100V 電源 → 調光ランプ、調光出力 → ランプの調光入力。
 * 基準（コモン）も繋いだ、正しく配線された最小構成。
 */
const dimmedLamp = (volts: number): CircuitDocument =>
  circuit(
    { PS: AC, DIM: dimmer("DIM", volts), L1: DIM_LAMP },
    [
      wire("PS:L", "L1:1"),
      wire("PS:N", "L1:2"),
      wire("DIM:V+", "L1:DIM+"),
      wire("DIM:COM", "L1:DIM-"),
    ],
  );

const levelOf = (result: SimulationResult, id: string) => {
  const level = result.analog.levelOf.get(id);
  if (!level) throw new Error(`${id} の調光レベルが無い`);
  return level;
};

describe("V → % の変換（逆特性）", () => {
  it("0V で 100%、10V で 0%、5V で 50%", () => {
    // 変換規則は定義側の宣言。エンジンは向きを知らない
    const curve = {
      minVolts: 0,
      maxVolts: 10,
      percentAtMin: 100,
      percentAtMax: 0,
    };
    expect(analogPercent(curve, 0)).toBe(100);
    expect(analogPercent(curve, 10)).toBe(0);
    expect(analogPercent(curve, 5)).toBe(50);
  });

  it("順特性の機器を足してもエンジンは同じ 1 本で通る", () => {
    // `percentAtMin` / `percentAtMax` を入れ替えるだけ。分岐は増えない
    const curve = {
      minVolts: 0,
      maxVolts: 10,
      percentAtMin: 0,
      percentAtMax: 100,
    };
    expect(analogPercent(curve, 0)).toBe(0);
    expect(analogPercent(curve, 10)).toBe(100);
  });

  it("範囲外の電圧は両端へ丸める", () => {
    const curve = {
      minVolts: 0,
      maxVolts: 10,
      percentAtMin: 100,
      percentAtMax: 0,
    };
    expect(analogPercent(curve, -5)).toBe(100);
    expect(analogPercent(curve, 99)).toBe(0);
  });

  it("出力電圧は定義の上下限へ丸める", () => {
    const source = {
      kind: "analog-source",
      signalTerminal: "V+",
      commonTerminal: "COM",
      minVolts: 0,
      maxVolts: 10,
      defaultVolts: 5,
    } as const;
    expect(outputVoltsOf(source, 20)).toBe(10);
    expect(outputVoltsOf(source, -3)).toBe(0);
    expect(outputVoltsOf(source, undefined)).toBe(5);
    // 数値でない値は既定へ倒す（保存 JSON が壊れていても部品は残す）
    expect(outputVoltsOf(source, Number.NaN)).toBe(5);
  });
});

describe("US-AK 調光器とランプを繋ぐと明るさが出る", () => {
  it("出力 0V でランプが 100%、10V で 0%", () => {
    const full = run(dimmedLamp(0));
    expect(levelOf(full, "L1").percent).toBe(100);
    expect(full.litLamps.has("L1")).toBe(true);

    const dark = run(dimmedLamp(10));
    expect(levelOf(dark, "L1").percent).toBe(0);
    // 電源は来ているが明るさ 0% なので点灯していない
    expect(dark.litLamps.has("L1")).toBe(false);
  });

  it("中間の電圧では中間の明るさになる", () => {
    const level = levelOf(run(dimmedLamp(2.5)), "L1");
    expect(level.volts).toBe(2.5);
    expect(level.percent).toBe(75);
  });

  it("電源が来ていなければ 100% の指示でも点灯しない", () => {
    // 明るさ（調光）と点灯（電源）は独立した軸（design.md §5.17）
    const document = circuit(
      { DIM: dimmer("DIM", 0), L1: DIM_LAMP },
      [wire("DIM:V+", "L1:DIM+"), wire("DIM:COM", "L1:DIM-")],
    );
    const result = run(document);
    expect(levelOf(result, "L1").percent).toBe(100);
    expect(result.litLamps.has("L1")).toBe(false);
  });

  it("端子には V が出る（部品には %）", () => {
    const result = run(dimmedLamp(4));
    const view = buildSimulationView(
      dimmedLamp(4),
      componentRegistry,
      result,
      new Set(),
    );
    expect(view.terminalVoltsOf.get(terminalKey("L1", "DIM+"))).toBe(4);
    expect(view.deviceOf.get("L1")?.dimming?.percent).toBe(60);
    expect(view.deviceOf.get("DIM")?.outputVolts).toBe(4);
  });

  it("調光を持たないランプには明るさが出ない", () => {
    // `dimming` の有無だけが違う（`kind` は同じ `lamp`）
    const document = circuit({ PS: DC, L1: "lamp-dc24v" }, [
      wire("PS:plus", "L1:1"),
      wire("PS:zero", "L1:2"),
    ]);
    const result = run(document);
    expect(result.analog.levelOf.has("L1")).toBe(false);
    expect(result.litLamps.has("L1")).toBe(true);
  });
});

describe("US-AL 挿し忘れが全灯として警告される", () => {
  it("調光信号が未接続だと 100% になり、その旨が診断に出る", () => {
    const document = circuit({ PS: AC, L1: DIM_LAMP }, [
      wire("PS:L", "L1:1"),
      wire("PS:N", "L1:2"),
    ]);
    const result = run(document);

    const level = levelOf(result, "L1");
    expect(level.floating).toBe(true);
    expect(level.percent).toBe(100);
    expect(result.litLamps.has("L1")).toBe(true);

    const warning = result.warnings.find(
      (w) => w.code === "unconnected-terminal" && w.terminalId === "DIM+",
    );
    expect(warning?.message).toContain("100%");
    // 使わない接点の未接続（info）と同じ重さにしない
    expect(warning?.severity).toBe("warning");
  });

  it("未接続時のレベルは定義から来る（エンジンが決め打ちしない）", () => {
    const definition = componentRegistry.get(DIM_LAMP);
    if (definition?.electrical.kind !== "lamp" || !definition.electrical.dimming) {
      throw new Error("調光ランプの定義が読めない");
    }
    const { dimming } = definition.electrical;
    expect(dimming.unconnectedVolts).toBe(0);
    // 定義の値と解の値が一致する＝エンジン側に 0 が焼き込まれていない
    const level = levelOf(
      run(
        circuit({ PS: AC, L1: DIM_LAMP }, [
          wire("PS:L", "L1:1"),
          wire("PS:N", "L1:2"),
        ]),
      ),
      "L1",
    );
    expect(level.volts).toBe(dimming.unconnectedVolts);
  });

  it("GND を共通にしていない調光信号は成立せず、接点の話をせずにそう言う", () => {
    // 信号線だけ引いてコモンを繋いでいない配線
    const document = circuit(
      { PS: AC, DIM: dimmer("DIM", 10), L1: DIM_LAMP },
      [wire("PS:L", "L1:1"), wire("PS:N", "L1:2"), wire("DIM:V+", "L1:DIM+")],
    );
    const result = run(document);

    const level = levelOf(result, "L1");
    expect(level.referenceMismatch).toBe(true);
    // 成立しない以上、未接続と同じレベル＝この仕様では全灯
    expect(level.percent).toBe(100);

    const warning = result.warnings.find(
      (w) => w.code === "analog-reference-mismatch",
    );
    expect(warning?.componentId).toBe("L1");
    expect(warning?.message).toContain("基準");
    // 直すのはコモン線 1 本。接点の話は出さない
    expect(warning?.message).not.toContain("接点");
  });
});

describe("停止中の配線チェックにも出る", () => {
  it("調光信号の未接続は ▶ を押す前に指摘される", () => {
    const warnings = inspectWiring(
      circuit({ PS: AC, L1: DIM_LAMP }, [
        wire("PS:L", "L1:1"),
        wire("PS:N", "L1:2"),
      ]),
      componentRegistry,
    );
    const warning = warnings.find(
      (w) => w.code === "unconnected-terminal" && w.terminalId === "DIM+",
    );
    expect(warning?.message).toContain("100%");
  });

  it("基準が共通でない配線も ▶ を押す前に指摘される", () => {
    // 接点の開閉に左右されない配線そのものの性質なので、静止状態で決まる
    const warnings = inspectWiring(
      circuit({ PS: AC, DIM: dimmer("DIM", 10), L1: DIM_LAMP }, [
        wire("PS:L", "L1:1"),
        wire("PS:N", "L1:2"),
        wire("DIM:V+", "L1:DIM+"),
      ]),
      componentRegistry,
    );
    expect(
      warnings.some((w) => w.code === "analog-reference-mismatch"),
    ).toBe(true);
  });

  it("正しく配線した調光では基準の警告が出ない", () => {
    const warnings = inspectWiring(dimmedLamp(5), componentRegistry);
    expect(
      warnings.filter((w) => w.code === "analog-reference-mismatch"),
    ).toEqual([]);
    expect(warnings.filter((w) => w.code === "power-short-circuit")).toEqual([]);
  });
});

describe("US-AM 接点で全灯にできる（DIRECT）", () => {
  /**
   * リレーの a 接点で調光信号線を 0V コモンへ落とす配線。
   * 押しボタンでリレーを励磁し、閉じた接点が V+ と COM を繋ぐ。
   */
  const directCircuit = (): CircuitDocument =>
    circuit(
      {
        PS: DC,
        AC1: AC,
        SW: PB_NO,
        RY: RELAY,
        DIM: dimmer("DIM", 10),
        L1: DIM_LAMP,
      },
      [
        // 制御回路: 押しボタン → コイル
        wire("PS:plus", "SW:1"),
        wire("SW:2", "RY:13"),
        wire("RY:14", "PS:zero"),
        // 負荷: AC100V → 調光ランプ
        wire("AC1:L", "L1:1"),
        wire("AC1:N", "L1:2"),
        // 調光: 10V（＝0%）を出しておく
        wire("DIM:V+", "L1:DIM+"),
        wire("DIM:COM", "L1:DIM-"),
        // DIRECT: a 接点（9–5）で信号線をコモンへ落とす
        wire("RY:9", "DIM:V+"),
        wire("RY:5", "DIM:COM"),
      ],
    );

  it("接点が閉じている間だけ 0V＝100% になる", () => {
    const document = directCircuit();

    const open = run(document);
    expect(levelOf(open, "L1").percent).toBe(0);

    const closed = run(document, ["SW"]);
    const level = levelOf(closed, "L1");
    expect(level.volts).toBe(0);
    expect(level.percent).toBe(100);
    expect(closed.litLamps.has("L1")).toBe(true);
  });

  it("接点が開くと調光器の出したレベルに戻る", () => {
    const document = directCircuit();
    // 押して離す（前回状態を引き継いでも戻ることを見る）
    const closed = run(document, ["SW"]);
    const reopened = simulate(document, componentRegistry, {
      pressedSwitches: new Set(),
      previousEnergizedRelays: closed.energizedRelays,
    });
    expect(levelOf(reopened, "L1").percent).toBe(0);
  });

  it("この配線が電源短絡として警告されない", () => {
    const document = directCircuit();
    for (const result of [run(document), run(document, ["SW"])]) {
      expect(
        result.warnings.filter((w) => w.code === "power-short-circuit"),
      ).toEqual([]);
    }
  });
});

describe("US-AN アナログ線が「非通電」に見えない", () => {
  it("0V を出している信号線が灰（非通電）にならない", () => {
    const document = dimmedLamp(0);
    const result = run(document);
    const view = buildSimulationView(
      document,
      componentRegistry,
      result,
      new Set(),
    );

    const state = view.wireOf.get("DIM:V+-L1:DIM+");
    expect(state).toBe("analog");
    expect(state).not.toBe("inactive");
    // レベルは色ではなく値として線に乗る
    expect(view.wireVoltsOf.get("DIM:V+-L1:DIM+")).toBe(0);
  });

  it("レベルの違いが線から読める", () => {
    for (const volts of [0, 3.5, 10]) {
      const document = dimmedLamp(volts);
      const view = buildSimulationView(
        document,
        componentRegistry,
        run(document),
        new Set(),
      );
      expect(view.wireVoltsOf.get("DIM:V+-L1:DIM+")).toBe(volts);
    }
  });

  it("停止中も配線漏れ（灰の破線）に見えない", () => {
    // 調光信号線はどう動作させても電源に届かない。`isolated` に落ちると
    // 正しく描かれた調光配線がすべて「直すべき線」に見える（§5.8）
    const roles = buildWireRoles(dimmedLamp(5), componentRegistry);
    expect(roles.get("DIM:V+-L1:DIM+")).toBe("analog");
    expect(roles.get("DIM:COM-L1:DIM-")).not.toBe("analog");
  });

  it("電源の 0V に落ちている信号線は青（0V）のまま", () => {
    /*
     * コモンを電源の 0V に繋いだうえで信号線をそこへ落とすと、その線は
     * **本当に電源の 0V 線**になる。専用色で塗るのは嘘なので、
     * 導通の色（青）が優先される（判定順・§5.17）。
     */
    const document = circuit(
      { PS: DC, AC1: AC, DIM: dimmer("DIM", 10), L1: DIM_LAMP },
      [
        wire("AC1:L", "L1:1"),
        wire("AC1:N", "L1:2"),
        wire("DIM:V+", "L1:DIM+"),
        wire("DIM:COM", "L1:DIM-"),
        wire("DIM:COM", "PS:zero"),
        // 信号線をコモンへ直結（DIRECT を接点なしで書いたもの）
        wire("DIM:V+", "DIM:COM"),
      ],
    );
    const result = run(document);
    const view = buildSimulationView(
      document,
      componentRegistry,
      result,
      new Set(),
    );

    expect(view.wireOf.get("DIM:V+-L1:DIM+")).toBe("zero");
    // 色は青でも、電圧は端子から読める
    expect(view.terminalVoltsOf.get(terminalKey("L1", "DIM+"))).toBe(0);
    expect(levelOf(result, "L1").percent).toBe(100);
  });

  it("導通の配線はアナログ色にならない", () => {
    const document = dimmedLamp(5);
    const view = buildSimulationView(
      document,
      componentRegistry,
      run(document),
      new Set(),
    );
    // 電源からランプへの線は通電中（緑）のまま
    expect(view.wireOf.get("PS:L-L1:1")).toBe("energized");
  });
});

describe("アナログ層は導通レイヤを変えない", () => {
  it("調光出力の 2 端子は union されない", () => {
    // union すると「繋いでいない」と「接点で 0V へ落とした」が区別できなくなる
    const document = dimmedLamp(5);
    const result = run(document);
    expect(result.netOf.get(terminalKey("DIM", "V+"))).not.toBe(
      result.netOf.get(terminalKey("DIM", "COM")),
    );
  });

  it("調光出力は電源として扱われない（電位を配らない）", () => {
    const document = dimmedLamp(5);
    const result = run(document);
    const netId = result.netOf.get(terminalKey("DIM", "V+"));
    const state = netId === undefined ? undefined : result.netState.get(netId);
    expect(state?.plusFrom.size).toBe(0);
    expect(state?.zeroFrom.size).toBe(0);
  });

  it("調光を使わない回路は解を持たない", () => {
    const document = circuit({ PS: DC, L1: "lamp-dc24v" }, [
      wire("PS:plus", "L1:1"),
      wire("PS:zero", "L1:2"),
    ]);
    const result = run(document);
    expect(result.analog.signalOf.size).toBe(0);
    expect(result.analog.levelOf.size).toBe(0);
  });

  it("同じ信号ネットを 2 台が駆動したら低いほうが勝つ", () => {
    /*
     * 「引き下げが勝つ」という 1 つの規則（§5.17）。DIRECT で 0V コモンへ
     * 落とす操作が全灯になるのと同じ規則の、極端でない側。
     */
    const document = circuit(
      {
        PS: AC,
        D1: dimmer("D1", 8),
        D2: dimmer("D2", 3),
        L1: DIM_LAMP,
      },
      [
        wire("PS:L", "L1:1"),
        wire("PS:N", "L1:2"),
        wire("D1:V+", "L1:DIM+"),
        wire("D2:V+", "L1:DIM+"),
        wire("D1:COM", "L1:DIM-"),
        wire("D2:COM", "L1:DIM-"),
      ],
    );
    const level = levelOf(run(document), "L1");
    expect(level.volts).toBe(3);
    expect(level.percent).toBe(70);
  });
});
