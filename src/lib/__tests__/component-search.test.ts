import { describe, expect, it } from "vitest";

import { componentDefinitions } from "@/circuit/definitions";
import { searchComponentDefinitions } from "@/lib/component-search";

/**
 * パレットの検索（design.md §8.5）。
 *
 * 絞り込みの規則を UI から切り離してあるので、ブラウザを起動せずに検証できる。
 */

const ids = (query: string): string[] =>
  searchComponentDefinitions(query).map((definition) => definition.id);

describe("部品検索", () => {
  it("空のクエリは全件を返す", () => {
    expect(searchComponentDefinitions("")).toHaveLength(
      componentDefinitions.length,
    );
    expect(searchComponentDefinitions("   ")).toHaveLength(
      componentDefinitions.length,
    );
  });

  it("型番の一部で引ける（大文字小文字を問わない）", () => {
    expect(ids("my2n")).toEqual(["omron-my2n-dc24"]);
    expect(ids("MY4N")).toEqual(["omron-my4n-dc24", "omron-my4n-d2-dc24"]);
    expect(ids("my4n-d2")).toEqual(["omron-my4n-d2-dc24"]);
  });

  it("メーカー名で引ける", () => {
    expect(ids("omron")).toEqual([
      "omron-my2n-dc24",
      "omron-my4n-dc24",
      "omron-my4n-d2-dc24",
      "omron-g7l-1a-t-dc24",
      "omron-g7l-2a-t-dc24",
    ]);
  });

  it("カテゴリの日本語表示で引ける", () => {
    expect(ids("端子台")).toEqual(["terminal-block-6p"]);
    expect(ids("ランプ")).toEqual(["lamp-dc24v"]);
    expect(ids("リレー")).toHaveLength(5);
  });

  it("空白区切りの語は AND で絞り込む", () => {
    expect(ids("omron d2")).toEqual(["omron-my4n-d2-dc24"]);
    // 片方でも当たらなければ落とす
    expect(ids("omron ランプ")).toEqual([]);
  });

  it("全角で確定した入力でも当たる（IME 対策）", () => {
    // 検索窓が動いていないように見えるのを防ぐため NFKC で正規化している
    expect(ids("ＭＹ２Ｎ")).toEqual(["omron-my2n-dc24"]);
  });

  it("一致しなければ空を返す", () => {
    expect(ids("LY2N")).toEqual([]);
  });
});
