/**
 * ヘルプの表が実際のキー割り当てとずれていないことを押さえる（design.md §8.10）。
 */

import { describe, expect, it } from "vitest";

import {
  ARRANGE_KEYS,
  COMPONENT_PANEL_KEYS,
  DELETE_KEYS,
  FLIP_KEYS,
  MAIN_VIEW_KEYS,
  PAN_ACTIVATION_KEY,
  PROPERTIES_PANEL_KEYS,
  SHORTCUT_GROUPS,
  SIMULATION_KEYS,
  displayKeys,
} from "@/lib/shortcuts";

const allRows = SHORTCUT_GROUPS.flatMap((group) => group.rows);

const rowFor = (action: string) => {
  const row = allRows.find((candidate) => candidate.action === action);
  if (!row) throw new Error(`ヘルプに「${action}」の行がありません`);
  return row;
};

describe("displayKeys", () => {
  it("CapsLock 対策の大文字・小文字を 1 つに畳む", () => {
    expect(displayKeys(["d", "D"])).toEqual(["D"]);
  });

  it("キー名（2 文字以上）はそのまま残す", () => {
    expect(displayKeys(["Delete", "Backspace"])).toEqual([
      "Delete",
      "Backspace",
    ]);
  });
});

describe("ヘルプの操作一覧", () => {
  it("削除の行が deleteKeyCode と一致する", () => {
    expect(rowFor("選択中の部品と配線を削除").keys).toEqual(
      displayKeys(DELETE_KEYS),
    );
  });

  it("反転の行が useFlipShortcut のキーと一致する", () => {
    expect(rowFor("選択中の部品を左右反転").keys).toEqual(
      displayKeys(FLIP_KEYS),
    );
  });

  it("整列の行が useArrangeShortcut のキーと一致する", () => {
    expect(rowFor("配置を整列").keys).toEqual(displayKeys(ARRANGE_KEYS));
  });

  it("開始・停止の行が useSimulationShortcut のキーと一致する", () => {
    expect(rowFor("シミュレーションの開始・停止").keys).toEqual(
      displayKeys(SIMULATION_KEYS),
    );
  });

  it("左右パネルのショートカットがヘルプと一致する", () => {
    expect(rowFor("部品パネルを開閉").keys).toEqual(
      displayKeys(COMPONENT_PANEL_KEYS),
    );
    expect(rowFor("プロパティパネルを開閉").keys).toEqual(
      displayKeys(PROPERTIES_PANEL_KEYS),
    );
    expect(rowFor("左右パネルをまとめて開閉").keys).toEqual(
      displayKeys(MAIN_VIEW_KEYS),
    );
  });

  it("単独キーの割り当てが互いに衝突しない", () => {
    const singles = [
      ...DELETE_KEYS,
      ...FLIP_KEYS,
      ...ARRANGE_KEYS,
      ...SIMULATION_KEYS,
      ...COMPONENT_PANEL_KEYS,
      ...PROPERTIES_PANEL_KEYS,
      ...MAIN_VIEW_KEYS,
    ].filter((key) => key.length === 1);
    expect(new Set(singles).size).toBe(singles.length);
  });

  it("画面移動の行が panActivationKeyCode を含む", () => {
    expect(
      rowFor("画面を動かす").keys.some((key) =>
        key.includes(PAN_ACTIVATION_KEY),
      ),
    ).toBe(true);
  });

  it("どの行もキーと動作の両方を持つ", () => {
    for (const row of allRows) {
      expect(row.keys.length).toBeGreaterThan(0);
      expect(row.action).not.toBe("");
    }
  });
});
