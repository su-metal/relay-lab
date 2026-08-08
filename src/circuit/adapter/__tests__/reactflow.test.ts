/**
 * adapter 層の検証。
 *
 * ここで守りたいのは「表示（Node/Edge）と電気的接続（CircuitConnection）を
 * 同一視しない」という設計原則 4 が、実際に往復して壊れないこと。
 * React Flow を実行時に import しないので node 環境でそのまま動く。
 */

import { describe, expect, it } from "vitest";

import {
  DEVICE_NODE_TYPE,
  canConnectTerminals,
  connectionFromReactFlow,
  hasTerminalPair,
  isSameTerminalPair,
  layoutTerminals,
  toDeviceNodes,
  toWireEdges,
} from "@/circuit/adapter/reactflow";
import { componentRegistry } from "@/circuit/definitions";
import type { CircuitDocument } from "@/circuit/types";

const document: CircuitDocument = {
  version: 1,
  components: [
    {
      id: "cmp-power",
      definitionId: "power-dc24v",
      label: "PS1",
      position: { x: 0, y: 0 },
    },
    {
      id: "cmp-relay",
      definitionId: "omron-my4n-dc24",
      label: "RY1",
      position: { x: 300, y: 40 },
    },
    // レジストリに無い定義 ID。Step 6 の読み込みで混入しうる
    {
      id: "cmp-unknown",
      definitionId: "not-registered",
      position: { x: 0, y: 400 },
    },
  ],
  connections: [
    {
      id: "wire-1",
      from: { componentId: "cmp-power", terminalId: "plus" },
      to: { componentId: "cmp-relay", terminalId: "14" },
    },
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
};

describe("toDeviceNodes", () => {
  it("部品インスタンスを定義付きのノードに変換する", () => {
    const nodes = toDeviceNodes(document, componentRegistry);
    const relay = nodes.find((node) => node.id === "cmp-relay");

    expect(relay?.type).toBe(DEVICE_NODE_TYPE);
    expect(relay?.position).toEqual({ x: 300, y: 40 });
    expect(relay?.data.definition.model).toBe("MY4N");
    expect(relay?.data.label).toBe("RY1");
  });

  it("寸法（measured）を定義から載せる", () => {
    // これが無いと React Flow がノードを初期化前とみなし、
    // ドキュメント更新のたびに端子の実測値を捨てて配線が消える
    const nodes = toDeviceNodes(document, componentRegistry);
    const relay = nodes.find((node) => node.id === "cmp-relay");
    const definition = componentRegistry.get("omron-my4n-dc24");

    expect(relay?.measured).toEqual({
      width: definition?.visual.width,
      height: definition?.visual.height,
    });
  });

  it("定義が見つからない部品は落とす（例外にしない）", () => {
    const nodes = toDeviceNodes(document, componentRegistry);
    expect(nodes.map((node) => node.id)).toEqual(["cmp-power", "cmp-relay"]);
  });

  it("選択中の ID をノードの selected に反映する", () => {
    const nodes = toDeviceNodes(document, componentRegistry, ["cmp-relay"]);
    expect(nodes.find((node) => node.id === "cmp-power")?.selected).toBe(false);
    expect(nodes.find((node) => node.id === "cmp-relay")?.selected).toBe(true);
  });
});

describe("左右反転（layoutTerminals）", () => {
  const relay = componentRegistry.get("omron-my4n-dc24");
  const power = componentRegistry.get("power-dc24v");

  it("反転していなければ定義の配列をそのまま返す", () => {
    if (!relay) throw new Error("MY4N の定義が無い");
    // 参照ごと同じであること。反転しない部品で毎回 14 個コピーしない
    expect(layoutTerminals(relay, false)).toBe(relay.terminals);
  });

  it("x 座標を鏡像にし、左右の辺を入れ替える", () => {
    if (!power) throw new Error("電源の定義が無い");
    const flipped = layoutTerminals(power, true);

    // 電源の端子は 2 つとも右辺（x: 1）にある
    expect(power.terminals.map((t) => [t.side, t.position.x])).toEqual([
      ["right", 1],
      ["right", 1],
    ]);
    expect(flipped.map((t) => [t.side, t.position.x])).toEqual([
      ["left", 0],
      ["left", 0],
    ]);
  });

  it("上下の端子は辺が変わらず、x だけが鏡像になる", () => {
    if (!relay) throw new Error("MY4N の定義が無い");
    const flipped = layoutTerminals(relay, true);
    // 端子 1 は第1接点 NC。上辺・x = 0.2（4 接点中 1 番目）
    const before = relay.terminals.find((t) => t.id === "1");
    const after = flipped.find((t) => t.id === "1");

    expect(before?.side).toBe("top");
    expect(after?.side).toBe("top");
    expect(after?.position.x).toBeCloseTo(1 - (before?.position.x ?? 0));
    expect(after?.position.y).toBe(before?.position.y);
  });

  it("端子の同一性（ID・ラベル・番号・役割）には触れない", () => {
    if (!relay) throw new Error("MY4N の定義が無い");
    const flipped = layoutTerminals(relay, true);

    // ここが変わると CircuitConnection の指す先が壊れる
    expect(flipped.map((t) => t.id)).toEqual(relay.terminals.map((t) => t.id));
    expect(flipped.map((t) => t.number)).toEqual(
      relay.terminals.map((t) => t.number),
    );
    expect(flipped.map((t) => t.role)).toEqual(
      relay.terminals.map((t) => t.role),
    );
  });

  it("定義そのものは書き換えない（他のインスタンスに波及させない）", () => {
    if (!power) throw new Error("電源の定義が無い");
    layoutTerminals(power, true);
    expect(power.terminals[0].side).toBe("right");
    expect(power.terminals[0].position.x).toBe(1);
  });
});

describe("toDeviceNodes と反転", () => {
  it("インスタンスの flipped を端子配置とノードデータに反映する", () => {
    const flippedDocument: CircuitDocument = {
      ...document,
      components: document.components.map((component) =>
        component.id === "cmp-power"
          ? { ...component, flipped: true }
          : component,
      ),
    };
    const nodes = toDeviceNodes(flippedDocument, componentRegistry);
    const powerNode = nodes.find((node) => node.id === "cmp-power");
    const relayNode = nodes.find((node) => node.id === "cmp-relay");

    expect(powerNode?.data.flipped).toBe(true);
    expect(powerNode?.data.terminals.map((t) => t.side)).toEqual([
      "left",
      "left",
    ]);
    // 反転していない部品は既定のまま
    expect(relayNode?.data.flipped).toBe(false);
    expect(relayNode?.data.terminals).toBe(relayNode?.data.definition.terminals);
  });
});

describe("toWireEdges", () => {
  it("端子 ID をそのまま Handle ID に載せる", () => {
    const [edge] = toWireEdges(document);
    expect(edge).toMatchObject({
      id: "wire-1",
      source: "cmp-power",
      sourceHandle: "plus",
      target: "cmp-relay",
      targetHandle: "14",
    });
  });
});

describe("connectionFromReactFlow", () => {
  it("Handle 付きの接続を CircuitConnection にする", () => {
    const connection = connectionFromReactFlow(
      {
        source: "cmp-power",
        sourceHandle: "zero",
        target: "cmp-relay",
        targetHandle: "13",
      },
      "wire-2",
    );

    expect(connection).toEqual({
      id: "wire-2",
      from: { componentId: "cmp-power", terminalId: "zero" },
      to: { componentId: "cmp-relay", terminalId: "13" },
    });
  });

  it("Handle が無い接続（部品本体への接続）は作らない", () => {
    const connection = connectionFromReactFlow(
      {
        source: "cmp-power",
        sourceHandle: null,
        target: "cmp-relay",
        targetHandle: "13",
      },
      "wire-2",
    );

    expect(connection).toBeNull();
  });

  it("同一端子どうしの自己接続は作らない", () => {
    const connection = connectionFromReactFlow(
      {
        source: "cmp-relay",
        sourceHandle: "14",
        target: "cmp-relay",
        targetHandle: "14",
      },
      "wire-2",
    );

    expect(connection).toBeNull();
  });

  it("同じ部品でも別端子どうしなら接続できる（渡り配線）", () => {
    const connection = connectionFromReactFlow(
      {
        source: "cmp-relay",
        sourceHandle: "9",
        target: "cmp-relay",
        targetHandle: "1",
      },
      "wire-2",
    );

    expect(connection).not.toBeNull();
  });
});

describe("重複配線の検出", () => {
  const wire = document.connections[0];

  it("配線に向きは無く、逆順でも同一の 1 本とみなす", () => {
    const reversed = { id: "wire-9", from: wire.to, to: wire.from };
    expect(isSameTerminalPair(wire, reversed)).toBe(true);
    expect(hasTerminalPair(document, reversed)).toBe(true);
  });

  it("端子が 1 つでも違えば別の配線", () => {
    const other = {
      id: "wire-9",
      from: { componentId: "cmp-power", terminalId: "plus" },
      to: { componentId: "cmp-relay", terminalId: "13" },
    };
    expect(isSameTerminalPair(wire, other)).toBe(false);
    expect(hasTerminalPair(document, other)).toBe(false);
  });
});

describe("canConnectTerminals", () => {
  it("既に張られている配線は許可しない", () => {
    expect(
      canConnectTerminals(document, {
        source: "cmp-relay",
        sourceHandle: "14",
        target: "cmp-power",
        targetHandle: "plus",
      }),
    ).toBe(false);
  });

  it("未接続の端子ペアは許可する", () => {
    expect(
      canConnectTerminals(document, {
        source: "cmp-relay",
        sourceHandle: "13",
        target: "cmp-power",
        targetHandle: "zero",
      }),
    ).toBe(true);
  });
});
