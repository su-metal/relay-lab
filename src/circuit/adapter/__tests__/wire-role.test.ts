/**
 * 停止中の配線の役割配色の検証（design.md §5.8）。
 *
 * ここで守りたいのは 3 点。
 * ①シミュレーションを回さずに（`simulate()` を呼ばずに）色が決まること
 * ②A 接点の先の線が「制御線」であって「配線漏れ」ではないと区別できること
 * ③停止中でも電源短絡が見えること
 */

import { describe, expect, it } from "vitest";

import { buildWireRoles } from "@/circuit/adapter/wire-role";
import { componentRegistry } from "@/circuit/definitions";
import type { CircuitConnection, CircuitDocument } from "@/circuit/types";

const wire = (
  id: string,
  from: [string, string],
  to: [string, string],
): CircuitConnection => ({
  id,
  from: { componentId: from[0], terminalId: from[1] },
  to: { componentId: to[0], terminalId: to[1] },
});

const at = (x: number, y: number) => ({ x, y });

const components: CircuitDocument["components"] = [
  { id: "ps", definitionId: "power-dc24v", label: "PS1", position: at(0, 0) },
  {
    id: "s1",
    definitionId: "switch-pushbutton-no",
    label: "S1",
    position: at(200, 0),
  },
  {
    id: "ry1",
    definitionId: "omron-my4n-dc24",
    label: "RY1",
    position: at(420, 0),
  },
  { id: "l1", definitionId: "lamp-dc24v", label: "L1", position: at(420, 300) },
];

/** `+24V → S1(A接点) → RY1 コイル 14 / 13 → 0V` と、RY1 の第1接点で点くランプ */
const document: CircuitDocument = {
  version: 1,
  components,
  connections: [
    wire("w-ps-s1", ["ps", "plus"], ["s1", "1"]),
    wire("w-s1-coil", ["s1", "2"], ["ry1", "14"]),
    wire("w-coil-zero", ["ry1", "13"], ["ps", "zero"]),
    wire("w-ps-com", ["ps", "plus"], ["ry1", "9"]),
    wire("w-no-lamp", ["ry1", "5"], ["l1", "1"]),
    wire("w-lamp-zero", ["l1", "2"], ["ps", "zero"]),
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
};

describe("buildWireRoles", () => {
  it("電源に直結した線を + 側 / 0V 側に振り分ける", () => {
    const roles = buildWireRoles(document, componentRegistry);

    expect(roles.get("w-ps-s1")).toBe("plus");
    expect(roles.get("w-ps-com")).toBe("plus");
    expect(roles.get("w-coil-zero")).toBe("zero");
    expect(roles.get("w-lamp-zero")).toBe("zero");
  });

  it("A 接点の先は制御線になる（静止状態では電源に届かないが配線漏れではない）", () => {
    const roles = buildWireRoles(document, componentRegistry);

    // S1 を押せば + に届く
    expect(roles.get("w-s1-coil")).toBe("control");
    // RY1 が励磁すれば COM(9)–NO(5) が閉じて + に届く
    expect(roles.get("w-no-lamp")).toBe("control");
  });

  it("どう動作させても電源に届かない線は isolated にする", () => {
    const orphan: CircuitDocument = {
      ...document,
      connections: [
        // 電源に一切つながらないランプ 1 個ぶんの配線
        wire("w-orphan", ["ry1", "4"], ["l1", "1"]),
      ],
    };
    const roles = buildWireRoles(orphan, componentRegistry);

    expect(roles.get("w-orphan")).toBe("isolated");
  });

  it("B 接点の先は静止状態で電源に届くので制御線ではなく電源色になる", () => {
    // 第1接点 COM(9) に + を入れ、NC(1) からランプへ。非励磁では閉じている
    const ncPath: CircuitDocument = {
      ...document,
      connections: [
        wire("w-ps-com", ["ps", "plus"], ["ry1", "9"]),
        wire("w-nc-lamp", ["ry1", "1"], ["l1", "1"]),
      ],
    };
    const roles = buildWireRoles(ncPath, componentRegistry);

    expect(roles.get("w-nc-lamp")).toBe("plus");
  });

  it("停止中でも電源短絡が分かる", () => {
    const shorted: CircuitDocument = {
      ...document,
      connections: [wire("w-short", ["ps", "plus"], ["ps", "zero"])],
    };
    const roles = buildWireRoles(shorted, componentRegistry);

    expect(roles.get("w-short")).toBe("short");
  });

  it("負荷は導通経路にならない（ランプの向こう側まで赤くしない）", () => {
    const throughLamp: CircuitDocument = {
      ...document,
      connections: [
        wire("w-ps-lamp", ["ps", "plus"], ["l1", "1"]),
        wire("w-lamp-coil", ["l1", "2"], ["ry1", "14"]),
      ],
    };
    const roles = buildWireRoles(throughLamp, componentRegistry);

    expect(roles.get("w-ps-lamp")).toBe("plus");
    // ランプを跨いだ先は + ではない（design.md §5.2）
    expect(roles.get("w-lamp-coil")).toBe("isolated");
  });

  /**
   * b 接点の直列チェーン（インターロック・先行優先）の起動経路。
   *
   * 全リレーを励磁させた状態では b 接点が開いてチェーンが丸ごと死ぬので、
   * 「静止」と「全動作」の 2 点だけでは**正しく描かれた起動経路が
   * まるごと配線漏れに見える。** その間の「スイッチは入っているが
   * リレーはまだ動いていない」状態を見れば救える。
   */
  it("b 接点チェーンの起動経路を配線漏れにしない", () => {
    const chain: CircuitDocument = {
      version: 1,
      components: [
        { id: "ps", definitionId: "power-dc24v", label: "PS1", position: at(0, 0) },
        {
          id: "sr",
          definitionId: "switch-selector-no",
          label: "SR",
          position: at(200, 0),
        },
        {
          id: "s1",
          definitionId: "switch-selector-no",
          label: "S1",
          position: at(400, 0),
        },
        {
          id: "ry1",
          definitionId: "omron-my4n-dc24",
          label: "RY1",
          position: at(600, 0),
        },
        {
          id: "ry2",
          definitionId: "omron-my2n-dc24",
          label: "RY2",
          position: at(600, 300),
        },
      ],
      connections: [
        wire("w-ps-sr", ["ps", "plus"], ["sr", "1"]),
        wire("w-sr-com", ["sr", "2"], ["ry1", "9"]),
        // RY1 の NC(1) → RY2 の COM(9) → RY2 の NC(1) → S1 という直列チェーン
        wire("w-chain-1", ["ry1", "1"], ["ry2", "9"]),
        wire("w-chain-2", ["ry2", "1"], ["s1", "1"]),
        // S1 で RY1 の第2接点 COM(10) を叩き、その NC(2) からコイルへ
        wire("w-s1-com2", ["s1", "2"], ["ry1", "10"]),
        wire("w-nc2-coil", ["ry1", "2"], ["ry1", "14"]),
        wire("w-coil-zero", ["ry1", "13"], ["ps", "zero"]),
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    const roles = buildWireRoles(chain, componentRegistry);

    // RY1 が励磁すると 9–1 が開いてこの先は死ぬが、それは配線漏れではない
    expect(roles.get("w-chain-1")).toBe("control");
    expect(roles.get("w-chain-2")).toBe("control");
    expect(roles.get("w-s1-com2")).toBe("control");
    expect(roles.get("w-nc2-coil")).toBe("control");
  });

  it("配線が無ければ空を返す（ネットを組み立てない）", () => {
    const empty: CircuitDocument = { ...document, connections: [] };
    expect(buildWireRoles(empty, componentRegistry).size).toBe(0);
  });
});
