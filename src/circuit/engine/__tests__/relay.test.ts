/**
 * 接点の開閉規則の検証（design.md §5.1）。
 *
 * ここで押さえたいのは **a 接点のみ（`SPST-NO`）のリレーが、非励磁のときに
 * どこにも閉じない**こと。c 接点の「COM は必ずどちらかに倒れる」を
 * a 接点にも当てはめると、実機に無い b 接点を勝手に生やすことになる。
 *
 * 定義ファイルではなくインラインの `RelayDefinition` を食わせている。
 * ここの検証対象はエンジンの規則そのものであって特定の型番ではない
 * （CLAUDE.md 設計原則 2）。
 */

import { describe, expect, it } from "vitest";

import { closedContactPairs } from "@/circuit/engine/relay";
import type { RelayDefinition } from "@/circuit/types";

const coil: RelayDefinition["coil"] = {
  voltage: 24,
  currentType: "DC",
  positiveTerminal: "A+",
  negativeTerminal: "A-",
  polarity: "none",
};

/** c 接点 2 回路（MY2N 相当の形） */
const spdtRelay: RelayDefinition = {
  coil,
  contacts: [
    { id: "c1", commonTerminal: "9", noTerminal: "5", ncTerminal: "1", type: "SPDT" },
    { id: "c2", commonTerminal: "12", noTerminal: "8", ncTerminal: "4", type: "SPDT" },
  ],
};

/** a 接点 2 回路。NC 端子は実機に存在しないので持たせない */
const noOnlyRelay: RelayDefinition = {
  coil,
  contacts: [
    { id: "c1", commonTerminal: "in1", noTerminal: "out1", type: "SPST-NO" },
    { id: "c2", commonTerminal: "in2", noTerminal: "out2", type: "SPST-NO" },
  ],
};

describe("closedContactPairs（design.md §5.1）", () => {
  it("c 接点は非励磁で COM–NC、励磁で COM–NO が閉じる", () => {
    expect(closedContactPairs(spdtRelay, false)).toEqual([
      ["9", "1"],
      ["12", "4"],
    ]);
    expect(closedContactPairs(spdtRelay, true)).toEqual([
      ["9", "5"],
      ["12", "8"],
    ]);
  });

  /**
   * **本テストの主眼。** 非励磁の a 接点は「開いている」のではなく
   * 閉じるペアが 1 つも無い。ここで COM–NC 相当のペアが 1 本でも出ると、
   * 存在しない端子どうしが union され、実機に無い経路ができる。
   */
  it("a 接点のみのリレーは非励磁でどのペアも閉じない", () => {
    expect(closedContactPairs(noOnlyRelay, false)).toEqual([]);
  });

  it("a 接点のみのリレーは励磁で COM–NO だけが閉じる", () => {
    expect(closedContactPairs(noOnlyRelay, true)).toEqual([
      ["in1", "out1"],
      ["in2", "out2"],
    ]);
  });

  it("接点を持たない定義でも例外にならない", () => {
    expect(closedContactPairs({ coil, contacts: [] }, true)).toEqual([]);
  });
});
