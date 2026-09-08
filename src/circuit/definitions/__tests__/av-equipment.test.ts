/**
 * AV 機器（プロジェクター・VP コントローラー・モニター・電動スクリーン）の
 * 検証（design.md §4.19・§5.21）。
 *
 * 押さえたいのは 3 点。
 *
 * 1. **補助コイル（`auxCoils`）が主コイルと独立に、それぞれ 2 端子間の
 *    電位だけで励磁を判定する。** 電動スクリーンの上昇・停止・下降が
 *    それぞれ独立して反応し、互いに干渉しない
 * 2. **VP コントローラーは普通の 1 コイル・0 接点のリレーとして動く。**
 *    接点を持たない機器でもコイルの励磁判定・極性検出は今までどおり効く
 * 3. **プロジェクター・モニターは AC100V を受けるだけの負荷。** 実端子番号を
 *    持たない汎用部品と同じ形で判定される
 */

import { describe, expect, it } from "vitest";

import {
  componentRegistry,
  dimmingConsole,
  dimmingController16ch,
  monitorGeneric,
  omronMy2nDc24,
  projectorPtVx430j,
  screenElectric,
  vpController,
} from "@/circuit/definitions";
import { simulate } from "@/circuit/engine";
import type {
  CircuitComponentInstance,
  CircuitConnection,
  CircuitDocument,
  ComponentDefinition,
} from "@/circuit/types";
import { operationKey } from "@/circuit/types";

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

const DC = "power-dc24v";

describe("電動スクリーン（design.md §5.21）", () => {
  /** DC24V の + を指定した入力端子へ、0V を COM へ配線する */
  const panel = (energizedTerminal?: "UP" | "STOP" | "DOWN") =>
    circuit(
      [
        ["PS", DC],
        ["SC", screenElectric.id],
      ],
      [
        wire("PS:zero", "SC:COM"),
        ...(energizedTerminal
          ? [wire("PS:plus", `SC:${energizedTerminal}`)]
          : []),
      ],
    );

  const auxOf = (result: ReturnType<typeof simulate>) =>
    [...(result.auxCoilsEnergized.get("SC") ?? [])].sort();

  it("何も繋がなければどの補助コイルも励磁しない", () => {
    const result = simulate(panel(), componentRegistry, {
      pressedSwitches: new Set(),
    });
    expect(auxOf(result)).toEqual([]);
    // 主コイルを持たない機器なので、接点側の energizedRelays にも入らない
    expect(result.energizedRelays.has("SC")).toBe(false);
  });

  it("上昇入力だけを繋ぐと「上昇」だけが励磁する", () => {
    const result = simulate(panel("UP"), componentRegistry, {
      pressedSwitches: new Set(),
    });
    expect(auxOf(result)).toEqual(["up"]);
  });

  it("停止入力だけを繋ぐと「停止」だけが励磁する", () => {
    const result = simulate(panel("STOP"), componentRegistry, {
      pressedSwitches: new Set(),
    });
    expect(auxOf(result)).toEqual(["stop"]);
  });

  it("下降入力だけを繋ぐと「下降」だけが励磁する", () => {
    const result = simulate(panel("DOWN"), componentRegistry, {
      pressedSwitches: new Set(),
    });
    expect(auxOf(result)).toEqual(["down"]);
  });

  it("2 系統を同時に繋ぐと両方が独立して励磁する（インターロックは持たない・design.md §6）", () => {
    const document = circuit(
      [
        ["PS", DC],
        ["SC", screenElectric.id],
      ],
      [
        wire("PS:zero", "SC:COM"),
        wire("PS:plus", "SC:UP"),
        wire("PS:plus", "SC:DOWN"),
      ],
    );
    const result = simulate(document, componentRegistry, {
      pressedSwitches: new Set(),
    });
    expect(auxOf(result)).toEqual(["down", "up"]);
  });

  it("極性は無いので、COM と入力端子を逆に繋いでも励磁する", () => {
    const document = circuit(
      [
        ["PS", DC],
        ["SC", screenElectric.id],
      ],
      [
        // わざと極性を逆に繋ぐ
        wire("PS:plus", "SC:COM"),
        wire("PS:zero", "SC:UP"),
      ],
    );
    const result = simulate(document, componentRegistry, {
      pressedSwitches: new Set(),
    });
    expect(auxOf(result)).toEqual(["up"]);
  });
});

describe("プロジェクター（Panasonic PT-VX430J）の USB 給電（design.md §4.19・§5.20）", () => {
  /**
   * `kind: "ac-dc-power-supply"` を再利用しているので、判定は S8VM と同じ
   * 「AC100V が L/N の両方に届いたときだけ、自分の VBUS/GND に別の DC 電位
   * を生成する」というもの（design.md §5.20）。
   */
  const withAc = (acConnected: boolean) =>
    circuit(
      [
        ...(acConnected
          ? [["PS", "power-ac100v"] as [string, string]]
          : []),
        ["PJ", projectorPtVx430j.id],
      ],
      acConnected ? [wire("PS:L", "PJ:L"), wire("PS:N", "PJ:N")] : [],
    );

  const reachesUsbPower = (result: ReturnType<typeof simulate>): boolean => {
    const vbusNet = result.netOf.get("PJ:VBUS");
    const gndNet = result.netOf.get("PJ:GND");
    if (vbusNet === undefined || gndNet === undefined) return false;
    return (
      (result.netState.get(vbusNet)?.plusFrom.has("PJ") ?? false) &&
      (result.netState.get(gndNet)?.zeroFrom.has("PJ") ?? false)
    );
  };

  it("AC100V が来ていれば USB VBUS/GND に別の DC 電位が立つ", () => {
    const result = simulate(withAc(true), componentRegistry, {
      pressedSwitches: new Set(),
    });
    expect(reachesUsbPower(result)).toBe(true);
  });

  it("AC100V が来ていなければ USB 電位は立たない", () => {
    const result = simulate(withAc(false), componentRegistry, {
      pressedSwitches: new Set(),
    });
    expect(reachesUsbPower(result)).toBe(false);
  });
});

describe("VP コントローラー（プロジェクターの USB 給電＋操作卓の電源ボタン・design.md §4.19）", () => {
  /**
   * VP:VBUS/GND をプロジェクターの USB 出力へ、VP:CTRL を調光操作卓の
   * 電源ボタンの無電圧接点（端子 5=COM・6=NO）を経由して VP:GND へ配線する。
   * 「プロジェクターが給電されていて、かつ操作卓の電源ボタンが ON」の
   * ときだけ VP コントローラーのコイルが励磁する、というのが押さえたい形。
   */
  const panel = (acConnected: boolean) =>
    circuit(
      [
        ...(acConnected
          ? [["PS", "power-ac100v"] as [string, string]]
          : []),
        ["PJ", projectorPtVx430j.id],
        ["VP", vpController.id],
        ["CONSOLE", dimmingConsole.id],
      ],
      [
        ...(acConnected
          ? [wire("PS:L", "PJ:L"), wire("PS:N", "PJ:N")]
          : []),
        wire("PJ:VBUS", "VP:VBUS"),
        wire("PJ:GND", "VP:GND"),
        wire("VP:CTRL", "CONSOLE:6"),
        wire("CONSOLE:5", "VP:GND"),
      ],
    );

  it("プロジェクターが給電されていて操作卓の電源ボタンが ON なら励磁する", () => {
    const result = simulate(panel(true), componentRegistry, {
      pressedSwitches: new Set(),
      operatedDevices: new Set([operationKey("CONSOLE", "power")]),
    });
    expect(result.energizedRelays.has("VP")).toBe(true);
  });

  it("操作卓の電源ボタンが OFF なら励磁しない", () => {
    const result = simulate(panel(true), componentRegistry, {
      pressedSwitches: new Set(),
      operatedDevices: new Set(),
    });
    expect(result.energizedRelays.has("VP")).toBe(false);
  });

  it("電源ボタンが ON でも、プロジェクターに AC100V が来ていなければ励磁しない（USB 給電が無いため）", () => {
    const result = simulate(panel(false), componentRegistry, {
      pressedSwitches: new Set(),
      operatedDevices: new Set([operationKey("CONSOLE", "power")]),
    });
    expect(result.energizedRelays.has("VP")).toBe(false);
  });

  it("何も繋がなければ励磁しない", () => {
    const document = circuit([["VP", vpController.id]], []);
    const result = simulate(document, componentRegistry, {
      pressedSwitches: new Set(),
    });
    expect(result.energizedRelays.has("VP")).toBe(false);
  });
});

describe("モニター（汎用）", () => {
  it("AC100V が両端に来ていれば負荷として成立する（design.md §4.19）", () => {
    const document = circuit(
      [
        ["PS", "power-ac100v"],
        ["MON", monitorGeneric.id],
      ],
      [wire("PS:L", "MON:L"), wire("PS:N", "MON:N")],
    );
    const result = simulate(document, componentRegistry, {
      pressedSwitches: new Set(),
    });
    expect(result.litLamps.has("MON")).toBe(true);
  });
});

describe("調光操作卓 → コントローラ → VP・スクリーンが実際に動く（design.md §5.22）", () => {
  /**
   * 添付回路（プロジェクター・VP コントローラー・電動スクリーン）と同じ形。
   * 操作卓の VP電源／スクリーン上昇/停止/下降ボタンが、通信でコントローラの
   * オープンコレクタ出力（端子 33〜36）を閉じ、その先の実機を実際に動かす
   * ところまでを一気通貫で確かめる。
   */
  const document = circuit(
    [
      ["CONSOLE", dimmingConsole.id],
      ["CTRL", dimmingController16ch.id],
      ["PS", "power-ac100v"],
      ["PJ", projectorPtVx430j.id],
      ["VP", vpController.id],
      ["DC", DC],
      ["SC", screenElectric.id],
    ],
    [
      // 操作卓 ↔ コントローラの通信線
      wire("CONSOLE:7", "CTRL:22"),
      wire("CONSOLE:8", "CTRL:23"),
      wire("CONSOLE:9", "CTRL:21"),
      // プロジェクターの AC100V 電源
      wire("PS:L", "PJ:L"),
      wire("PS:N", "PJ:N"),
      // VP コントローラーはプロジェクターの USB 給電で動作し、
      // 制御入力（CTRL）をコントローラの端子 33 へ
      wire("PJ:VBUS", "VP:VBUS"),
      wire("PJ:GND", "VP:GND"),
      wire("VP:CTRL", "CTRL:33"),
      // オープンコレクタの基準（GND）を VP コントローラー側の 0V と共有する
      wire("CTRL:21", "VP:GND"),
      // 電動スクリーンは DC24V を外部電源とし、上昇/停止/下降をコントローラの
      // 端子 34/35/36 へ
      wire("DC:plus", "SC:COM"),
      wire("DC:zero", "CTRL:21"),
      wire("CTRL:34", "SC:UP"),
      wire("CTRL:35", "SC:STOP"),
      wire("CTRL:36", "SC:DOWN"),
    ],
  );

  const auxOf = (result: ReturnType<typeof simulate>) =>
    [...(result.auxCoilsEnergized.get("SC") ?? [])].sort();

  it("何も操作していなければ VP もスクリーンも動かない", () => {
    const result = simulate(document, componentRegistry, {
      pressedSwitches: new Set(),
    });
    expect(result.energizedRelays.has("VP")).toBe(false);
    expect(auxOf(result)).toEqual([]);
  });

  it("VP電源ボタンを倒すと VP コントローラーのコイルが励磁する", () => {
    const result = simulate(document, componentRegistry, {
      pressedSwitches: new Set(),
      operatedDevices: new Set([operationKey("CONSOLE", "vpPower")]),
    });
    expect(result.energizedRelays.has("VP")).toBe(true);
    // スクリーンは操作していないので動かない
    expect(auxOf(result)).toEqual([]);
  });

  it("スクリーン上昇ボタンを倒すと上昇だけが励磁する", () => {
    const result = simulate(document, componentRegistry, {
      pressedSwitches: new Set(),
      operatedDevices: new Set([operationKey("CONSOLE", "screenUp")]),
    });
    expect(auxOf(result)).toEqual(["up"]);
    expect(result.energizedRelays.has("VP")).toBe(false);
  });

  it("スクリーン停止ボタンを倒すと停止だけが励磁する", () => {
    const result = simulate(document, componentRegistry, {
      pressedSwitches: new Set(),
      operatedDevices: new Set([operationKey("CONSOLE", "screenStop")]),
    });
    expect(auxOf(result)).toEqual(["stop"]);
  });

  it("スクリーン下降ボタンを倒すと下降だけが励磁する", () => {
    const result = simulate(document, componentRegistry, {
      pressedSwitches: new Set(),
      operatedDevices: new Set([operationKey("CONSOLE", "screenDown")]),
    });
    expect(auxOf(result)).toEqual(["down"]);
  });

  it("VP電源とスクリーン上昇を同時に倒しても互いに干渉しない", () => {
    const result = simulate(document, componentRegistry, {
      pressedSwitches: new Set(),
      operatedDevices: new Set([
        operationKey("CONSOLE", "vpPower"),
        operationKey("CONSOLE", "screenUp"),
      ]),
    });
    expect(result.energizedRelays.has("VP")).toBe(true);
    expect(auxOf(result)).toEqual(["up"]);
  });
});

describe("調光操作卓の電源ボタンでモニターを連動させる", () => {
  /**
   * モニターは制御端子を持たない負荷なので（本ファイル冒頭の doc comment）、
   * 外部のリレーで AC100V ラインを断続する。**ここは端子 33〜39 を使わない**
   * —— 操作卓自身の電源接点（端子 2＝AUX1 オープンコレクタ出力、電源 NO）が
   * 実機どおりコンソールパネルに既にあり、社内仕様書（ver.1.1）にモニター専用
   * ボタンの記載は無いため、新しい操作子を作らずこの実在の接点を使う
   * （ユーザー判断）。
   */
  const document = circuit(
    [
      ["CONSOLE", dimmingConsole.id],
      ["DC", DC],
      ["RY", omronMy2nDc24.id],
      ["PS", "power-ac100v"],
      ["MON", monitorGeneric.id],
    ],
    [
      // リレーのコイルは DC24V から、操作卓の電源 NO 接点（端子 2）を経由
      wire("DC:plus", "RY:14"),
      wire("RY:13", "CONSOLE:2"),
      wire("CONSOLE:9", "DC:zero"),
      // リレーの接点でモニターの AC100V ラインを断続する
      wire("PS:L", "RY:9"),
      wire("RY:5", "MON:L"),
      wire("PS:N", "MON:N"),
    ],
  );

  it("操作卓の電源ボタンが OFF ならモニターは点かない", () => {
    const result = simulate(document, componentRegistry, {
      pressedSwitches: new Set(),
      operatedDevices: new Set(),
    });
    expect(result.energizedRelays.has("RY")).toBe(false);
    expect(result.litLamps.has("MON")).toBe(false);
  });

  it("操作卓の電源ボタンを倒すとリレーが動き、モニターが点く", () => {
    const result = simulate(document, componentRegistry, {
      pressedSwitches: new Set(),
      operatedDevices: new Set([operationKey("CONSOLE", "power")]),
    });
    expect(result.energizedRelays.has("RY")).toBe(true);
    expect(result.litLamps.has("MON")).toBe(true);
  });
});

describe("AV機器の端子データ", () => {
  it("実端子番号を持たないので verified を名乗らない", () => {
    for (const definition of [
      projectorPtVx430j,
      vpController,
      monitorGeneric,
      screenElectric,
    ]) {
      expect(
        definition.terminals.every((t) => t.number === undefined),
        definition.id,
      ).toBe(true);
      expect(definition.verified, definition.id).toBe(false);
    }
  });
});

/**
 * 補助コイルの極性検出はエンジンの一般機能（design.md §5.21）であって
 * 特定の AV 機器に固有のものではないので、実在の定義には頼らず
 * 最小の合成定義で検証する（`polarity: "strict"` を持つ補助コイルは
 * 今のところどの登録済み定義にも無いため）。
 */
describe("補助コイルの極性検出（design.md §5.21・エンジンの一般機能）", () => {
  const strictAuxDefinition: ComponentDefinition = {
    id: "test-strict-aux-coil",
    model: "テスト用（極性ありの補助コイル）",
    category: "av",
    terminals: [
      { id: "P", label: "P", role: "coil", position: { x: 0, y: 0.3 }, side: "left" },
      { id: "M", label: "M", role: "coil", position: { x: 0, y: 0.7 }, side: "left" },
    ],
    electrical: {
      kind: "relay",
      relay: {
        auxCoils: [
          {
            id: "aux1",
            label: "補助1",
            voltage: 24,
            currentType: "DC",
            positiveTerminal: "P",
            negativeTerminal: "M",
            polarity: "strict",
          },
        ],
        contacts: [],
      },
    },
    visual: { width: 120, height: 120 },
    source: "テスト用の合成定義",
    verified: false,
  };
  // DC24V 電源など実在の定義も要るので、登録済みレジストリに合成定義を足す
  const registry = new Map(componentRegistry).set(
    strictAuxDefinition.id,
    strictAuxDefinition,
  );

  it("正しい極性で繋げば励磁し、警告も出ない", () => {
    const document = circuit(
      [
        ["PS", DC],
        ["T1", strictAuxDefinition.id],
      ],
      [wire("PS:plus", "T1:P"), wire("PS:zero", "T1:M")],
    );
    const result = simulate(document, registry, { pressedSwitches: new Set() });
    expect([...(result.auxCoilsEnergized.get("T1") ?? [])]).toEqual(["aux1"]);
    expect(
      result.warnings.filter((w) => w.code === "coil-polarity-reversed"),
    ).toEqual([]);
  });

  it("逆に繋ぐと励磁せず、極性の警告が出る", () => {
    const document = circuit(
      [
        ["PS", DC],
        ["T1", strictAuxDefinition.id],
      ],
      // わざと極性を逆に繋ぐ
      [wire("PS:plus", "T1:M"), wire("PS:zero", "T1:P")],
    );
    const result = simulate(document, registry, { pressedSwitches: new Set() });
    expect([...(result.auxCoilsEnergized.get("T1") ?? [])]).toEqual([]);
    const warnings = result.warnings.filter(
      (w) => w.code === "coil-polarity-reversed",
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe("error");
    expect(warnings[0].componentId).toBe("T1");
  });
});
