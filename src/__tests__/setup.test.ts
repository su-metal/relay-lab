import { describe, expect, it } from "vitest";

import { APP_NAME, MAX_ITERATIONS } from "@/lib/app-info";

/**
 * Step 0 のスモークテスト。
 *
 * vitest はテストファイルが 0 件だと終了コード 1 で落ちるため、
 * ツールチェーンの疎通確認を兼ねた 1 本を置いている。
 * Step 2 で本命の検証回路テスト（src/circuit/engine/__tests__/scenarios.test.ts）を追加する。
 */
describe("プロジェクトセットアップ", () => {
  it("@/ エイリアスで src 配下のモジュールを解決できる", () => {
    expect(APP_NAME).toBe("relay-lab");
  });

  it("収束計算の最大反復回数が design.md §5.5 の 100 と一致する", () => {
    expect(MAX_ITERATIONS).toBe(100);
  });
});
