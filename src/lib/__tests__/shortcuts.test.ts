/**
 * ヘルプの表が実際のキー割り当てとずれていないことを押さえる（design.md §8.10）。
 *
 * ヘルプは「書き写した瞬間から古くなる」種類のドキュメントで、しかも
 * **間違ったヘルプは無いヘルプより悪い。** 表を定数から組み立てているという
 * 前提が崩れたらここで落ちる。
 */

import { describe, expect, it } from "vitest";

import {
  ARRANGE_KEYS,
  DELETE_KEYS,
  FLIP_KEYS,
  PAN_ACTIVATION_KEY,
  SHORTCUT_GROUPS,
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

  /**
   * 初見でいちばん困るのが「画面が動かせない」なので、
   * パンの同時押しキーがヘルプに載っていることは特に落としたくない。
   */
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
