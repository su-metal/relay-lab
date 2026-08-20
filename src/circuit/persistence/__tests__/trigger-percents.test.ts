import { describe, expect, it } from "vitest";

import { componentRegistry } from "@/circuit/definitions";
import { simulate } from "@/circuit/engine";
import {
  parseDocument,
  serializeDocument,
} from "@/circuit/persistence/document-storage";
import type { CircuitDocument, SimulationResult } from "@/circuit/types";

/**
 * カットリレーの動作点（実機の CUT ADJ.）が保存・読み込みを越えて残る
 * ことの検証（design.md §4.16）。
 *
 * **ここが抜けていた。** 型もエンジンも揃っていて、値を書いても例外は
 * 出ないが、永続化に読み手が無いため保存して開き直すと黙って定義の
 * 既定値へ戻っていた。「設定したのに効かない」は動かないより発見が遅れる。
 */

const CONTROLLER = "dimming-controller-16ch";
const LIGHT_CTRL = "light-controller-4ch";

/** 調光コントローラの回路 1 → ライトコントローラの入力 1 */
const circuit = (volts: number, percents?: Record<string, number>): CircuitDocument => ({
  version: 1,
  components: [
    {
      id: "C1",
      definitionId: CONTROLLER,
      label: "C1",
      position: { x: 0, y: 0 },
      channelVolts: { "1": volts },
    },
    {
      id: "LC",
      definitionId: LIGHT_CTRL,
      label: "LC",
      position: { x: 200, y: 0 },
      ...(percents ? { triggerPercents: percents } : {}),
    },
  ],
  connections: [
    {
      id: "w1",
      from: { componentId: "C1", terminalId: "1" },
      to: { componentId: "LC", terminalId: "IN1" },
    },
    {
      id: "w2",
      from: { componentId: "C1", terminalId: "21" },
      to: { componentId: "LC", terminalId: "ING" },
    },
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
});

const step = (document: CircuitDocument): SimulationResult =>
  simulate(document, componentRegistry, { pressedSwitches: new Set() });

/** カットリレーの第 1 回路が動作しているか */
const cutOperated = (result: SimulationResult): boolean =>
  result.operatedContacts.get("LC")?.has("c1") === true;

/** 保存 → 読み込みを 1 往復させる */
const roundTrip = (document: CircuitDocument): CircuitDocument => {
  const loaded = parseDocument(serializeDocument(document), componentRegistry);
  if (loaded.status !== "loaded") throw new Error(JSON.stringify(loaded));
  return loaded.document;
};

describe("カットリレーの動作点は保存・読み込みを越えて残る", () => {
  /*
   * この盤は逆特性（0V = 100%）なので 7V ＝ 30%。
   * 定義の既定は 25%、設定するのは 40%。**この 2 つで答えが分かれる電圧**を
   * わざと選んでいる —— 8V（20%）ではどちらでも動作してしまい、
   * 動作点が効いていないことを見逃す。
   */
  const VOLTS = 7;

  it("既定（25%）では 30% の明るさで動作しない", () => {
    expect(cutOperated(step(circuit(VOLTS)))).toBe(false);
  });

  it("動作点を 40% にすると動作する", () => {
    expect(cutOperated(step(circuit(VOLTS, { c1: 40 })))).toBe(true);
  });

  /** **本テストの主眼。** ここが落ちていた */
  it("保存して読み込んでも 40% のまま動作する", () => {
    const reloaded = roundTrip(circuit(VOLTS, { c1: 40 }));
    expect(reloaded.components.find((c) => c.id === "LC")?.triggerPercents).toEqual({
      c1: 40,
    });
    expect(cutOperated(step(reloaded))).toBe(true);
  });

  it("範囲外は定義の上下限（0〜50%）へ丸める", () => {
    const reloaded = roundTrip(circuit(VOLTS, { c1: 90 }));
    expect(reloaded.components.find((c) => c.id === "LC")?.triggerPercents).toEqual({
      c1: 50,
    });
  });

  /** 定義に無い接点の値は捨てる（端子を減らした定義への対応） */
  it("定義に無い接点の値は捨てる", () => {
    const reloaded = roundTrip(circuit(VOLTS, { c1: 40, zzz: 10 }));
    expect(reloaded.components.find((c) => c.id === "LC")?.triggerPercents).toEqual({
      c1: 40,
    });
  });

  /** 動作点を持たない部品には残さない（保存 JSON に誰も読まない値を置かない） */
  it("動作点を持たない部品では undefined", () => {
    const reloaded = roundTrip(circuit(VOLTS, { c1: 40 }));
    expect(reloaded.components.find((c) => c.id === "C1")?.triggerPercents).toBeUndefined();
  });
});
