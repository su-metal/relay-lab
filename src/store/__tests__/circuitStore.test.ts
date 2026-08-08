/**
 * Undo / Redo の検証（design.md §7）。
 *
 * 守りたいのは **スナップショット地点が 4 点だけ**（部品追加 / 削除 / 配線確定 /
 * ドラッグ完了）であること。1 回のドラッグや 1 文字のラベル入力で履歴が
 * 数十件積まれると、Undo が「1 手戻る」道具として使えなくなる（要件 US-E）。
 *
 * Zustand のストアはフックを介さずに `getState()` から直接叩けるので、
 * React を描画せずに node 環境で検証できる。
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  dc24vLamp,
  dc24vPowerSupply,
  omronMy2nDc24,
  omronMy4nDc24,
  pushbuttonNc,
  pushbuttonNo,
} from "@/circuit/definitions";
import type { CircuitDocument } from "@/circuit/types";
import { useCircuitStore } from "@/store/circuitStore";

const store = () => useCircuitStore.getState();

const emptyDocument = (): CircuitDocument => ({
  version: 1,
  components: [],
  connections: [],
  viewport: { x: 0, y: 0, zoom: 1 },
});

beforeEach(() => {
  store().replaceDocument(emptyDocument());
});

describe("履歴のスナップショット地点", () => {
  it("部品追加を 1 手ずつ戻し、やり直せる", () => {
    store().addComponent(dc24vPowerSupply, { x: 0, y: 0 });
    store().addComponent(dc24vLamp, { x: 200, y: 0 });
    expect(store().document.components).toHaveLength(2);

    store().undo();
    expect(store().document.components).toHaveLength(1);
    store().undo();
    expect(store().document.components).toHaveLength(0);

    // これ以上戻る先が無ければ何も起きない
    store().undo();
    expect(store().document.components).toHaveLength(0);

    store().redo();
    store().redo();
    expect(store().document.components).toHaveLength(2);
  });

  it("ドラッグ中の moveComponent は履歴に積まず、ドラッグ完了の 1 手にまとめる", () => {
    const id = store().addComponent(dc24vPowerSupply, { x: 0, y: 0 });
    const historyAfterAdd = store().past.length;

    store().beginComponentDrag();
    for (let step = 1; step <= 50; step += 1) {
      store().moveComponent(id, { x: step * 4, y: step * 2 });
    }
    store().endComponentDrag();

    expect(store().past).toHaveLength(historyAfterAdd + 1);
    expect(store().document.components[0]?.position).toEqual({ x: 200, y: 100 });

    // 1 手戻ればドラッグ前の位置に戻る（部品は消えない）
    store().undo();
    expect(store().document.components).toHaveLength(1);
    expect(store().document.components[0]?.position).toEqual({ x: 0, y: 0 });
  });

  it("掴んだだけで動かさなければ履歴を積まない", () => {
    store().addComponent(dc24vPowerSupply, { x: 0, y: 0 });
    const before = store().past.length;

    store().beginComponentDrag();
    store().endComponentDrag();

    expect(store().past).toHaveLength(before);
  });

  it("ラベル編集は履歴に積まない（1 文字ごとに発火するため）", () => {
    const id = store().addComponent(dc24vPowerSupply, { x: 0, y: 0 });
    const before = store().past.length;

    for (const label of ["P", "PS", "PS1"]) {
      store().setComponentLabel(id, label);
    }

    expect(store().past).toHaveLength(before);
    expect(store().document.components[0]?.label).toBe("PS1");
  });

  it("パン・ズームは履歴に積まず、Undo でも表示位置を動かさない", () => {
    store().addComponent(dc24vPowerSupply, { x: 0, y: 0 });
    const before = store().past.length;

    store().setViewport({ x: -120, y: 40, zoom: 1.5 });
    expect(store().past).toHaveLength(before);

    store().undo();
    expect(store().document.components).toHaveLength(0);
    expect(store().document.viewport).toEqual({ x: -120, y: 40, zoom: 1.5 });
  });
});

describe("削除と選択", () => {
  it("選択した部品と配線をまとめて 1 手で消す", () => {
    const power = store().addComponent(dc24vPowerSupply, { x: 0, y: 0 });
    const lamp = store().addComponent(dc24vLamp, { x: 200, y: 0 });
    store().addConnection({
      source: power,
      sourceHandle: "plus",
      target: lamp,
      targetHandle: "1",
    });
    expect(store().document.connections).toHaveLength(1);

    store().setComponentSelected(power, true);
    store().setComponentSelected(lamp, true);
    const before = store().past.length;
    store().removeSelected();

    expect(store().document.components).toHaveLength(0);
    // 部品を消せば、その端子に繋がっていた配線も道連れになる
    expect(store().document.connections).toHaveLength(0);
    expect(store().past).toHaveLength(before + 1);

    store().undo();
    expect(store().document.components).toHaveLength(2);
    expect(store().document.connections).toHaveLength(1);
  });

  it("範囲選択でまとめて消しても履歴は 1 手（Undo 1 回で全部戻る）", () => {
    const power = store().addComponent(dc24vPowerSupply, { x: 0, y: 0 });
    const lampA = store().addComponent(dc24vLamp, { x: 200, y: 0 });
    const lampB = store().addComponent(dc24vLamp, { x: 400, y: 0 });
    store().addConnection({
      source: power,
      sourceHandle: "plus",
      target: lampA,
      targetHandle: "1",
    });
    store().addConnection({
      source: lampA,
      sourceHandle: "2",
      target: lampB,
      targetHandle: "1",
    });
    const wires = store().document.connections.map((connection) => connection.id);
    expect(wires).toHaveLength(2);

    const before = store().past.length;
    // 部品 3 個と配線 2 本 = 要素 5 個を 1 回の削除として渡す
    store().removeElements([power, lampA, lampB], wires);

    expect(store().document.components).toHaveLength(0);
    expect(store().document.connections).toHaveLength(0);
    expect(store().past).toHaveLength(before + 1);

    store().undo();
    expect(store().document.components).toHaveLength(3);
    expect(store().document.connections).toHaveLength(2);
  });

  it("配線だけを消しても部品は残る", () => {
    const power = store().addComponent(dc24vPowerSupply, { x: 0, y: 0 });
    const lamp = store().addComponent(dc24vLamp, { x: 200, y: 0 });
    store().addConnection({
      source: power,
      sourceHandle: "plus",
      target: lamp,
      targetHandle: "1",
    });
    const wire = store().document.connections[0]!.id;

    store().removeElements([], [wire]);

    expect(store().document.connections).toHaveLength(0);
    expect(store().document.components).toHaveLength(2);
  });

  it("存在しない ID だけなら履歴を汚さない", () => {
    store().addComponent(dc24vPowerSupply, { x: 0, y: 0 });
    const before = store().past.length;

    store().removeElements(["cmp-missing"], ["wire-missing"]);
    store().removeElements([], []);

    expect(store().past).toHaveLength(before);
  });

  it("setSelectedConnections は選択を丸ごと差し替える", () => {
    store().setSelectedConnections(["wire-a", "wire-b"]);
    expect(store().selectedConnectionIds).toEqual(["wire-a", "wire-b"]);

    // 枠を縮めて外れた配線は残さない
    store().setSelectedConnections(["wire-b"]);
    expect(store().selectedConnectionIds).toEqual(["wire-b"]);

    // 中身が同じなら参照も変えない（範囲選択中の毎フレーム再描画を止める）
    const kept = store().selectedConnectionIds;
    store().setSelectedConnections(["wire-b"]);
    expect(store().selectedConnectionIds).toBe(kept);
  });

  it("Undo で消えた部品を選択したままにしない", () => {
    const power = store().addComponent(dc24vPowerSupply, { x: 0, y: 0 });
    store().setComponentSelected(power, true);
    expect(store().selectedComponentIds).toEqual([power]);

    store().undo();
    expect(store().selectedComponentIds).toEqual([]);
  });

  it("新しい操作をすると Redo の枝を捨てる", () => {
    store().addComponent(dc24vPowerSupply, { x: 0, y: 0 });
    store().undo();
    expect(store().future).toHaveLength(1);

    store().addComponent(dc24vLamp, { x: 0, y: 0 });
    expect(store().future).toHaveLength(0);
  });
});

/**
 * 配線のつなぎ替え（design.md §8.8）。
 *
 * 守りたいのは **同じ 1 本のまま端子だけが移る**こと。消して張り直す実装にすると
 * ID が変わり、選択が外れ、Undo も「削除」「追加」の 2 手になる。
 */
describe("配線のつなぎ替え", () => {
  /** 電源 + → ランプ 1 の 1 本だけを張った回路。ランプはもう 1 個置いておく */
  const wiredCircuit = () => {
    const power = store().addComponent(dc24vPowerSupply, { x: 0, y: 0 });
    const lampA = store().addComponent(dc24vLamp, { x: 200, y: 0 });
    const lampB = store().addComponent(dc24vLamp, { x: 400, y: 0 });
    store().addConnection({
      source: power,
      sourceHandle: "plus",
      target: lampA,
      targetHandle: "1",
    });
    return { power, lampA, lampB, wire: store().document.connections[0]!.id };
  };

  it("端子だけが移り、配線 ID は変わらない", () => {
    const { power, lampB, wire } = wiredCircuit();
    const before = store().past.length;

    // ランプ A 側の端を掴んでランプ B の端子 1 へ落とす
    store().reconnectConnection(wire, {
      source: power,
      sourceHandle: "plus",
      target: lampB,
      targetHandle: "1",
    });

    expect(store().document.connections).toHaveLength(1);
    const connection = store().document.connections[0]!;
    expect(connection.id).toBe(wire);
    expect(connection.to).toEqual({ componentId: lampB, terminalId: "1" });
    expect(store().past).toHaveLength(before + 1);
  });

  it("Undo 1 回で元の端子に戻る（削除と追加の 2 手にならない）", () => {
    const { power, lampA, lampB, wire } = wiredCircuit();

    store().reconnectConnection(wire, {
      source: power,
      sourceHandle: "plus",
      target: lampB,
      targetHandle: "1",
    });
    store().undo();

    expect(store().document.connections).toHaveLength(1);
    const connection = store().document.connections[0]!;
    expect(connection.id).toBe(wire);
    expect(connection.to).toEqual({ componentId: lampA, terminalId: "1" });
  });

  it("掴んで同じ端子へ戻しただけなら履歴を汚さない", () => {
    const { power, lampA, wire } = wiredCircuit();
    const before = store().past.length;

    // 向きを入れ替えて落とす（配線に向きは無いので同じ 1 本）
    store().reconnectConnection(wire, {
      source: lampA,
      sourceHandle: "1",
      target: power,
      targetHandle: "plus",
    });

    expect(store().past).toHaveLength(before);
    expect(store().document.connections[0]!.to).toEqual({
      componentId: lampA,
      terminalId: "1",
    });
  });

  it("既に同じ端子ペアの配線があるつなぎ替えは、元のまま残す", () => {
    const { power, lampA, lampB, wire } = wiredCircuit();
    // 電源 + → ランプ B 1 を別に張っておく
    store().addConnection({
      source: power,
      sourceHandle: "plus",
      target: lampB,
      targetHandle: "1",
    });
    const before = store().past.length;

    store().reconnectConnection(wire, {
      source: power,
      sourceHandle: "plus",
      target: lampB,
      targetHandle: "1",
    });

    expect(store().past).toHaveLength(before);
    expect(store().document.connections).toHaveLength(2);
    expect(store().document.connections[0]!.to).toEqual({
      componentId: lampA,
      terminalId: "1",
    });
  });

  it("端子以外への落とし先・存在しない配線 ID は空振り", () => {
    const { power, lampB, wire } = wiredCircuit();
    const before = store().past.length;

    // 部品本体へのドロップ（Handle ID が無い）
    store().reconnectConnection(wire, {
      source: power,
      sourceHandle: "plus",
      target: lampB,
      targetHandle: null,
    });
    store().reconnectConnection("wire-nope", {
      source: power,
      sourceHandle: "plus",
      target: lampB,
      targetHandle: "1",
    });

    expect(store().past).toHaveLength(before);
    expect(store().document.connections).toHaveLength(1);
  });
});

describe("左右反転", () => {
  it("トグルで反転し、1 手で戻せる", () => {
    const id = store().addComponent(dc24vPowerSupply, { x: 0, y: 0 });
    const before = store().past.length;

    store().flipComponents([id]);
    expect(store().document.components[0]?.flipped).toBe(true);
    expect(store().past).toHaveLength(before + 1);

    store().flipComponents([id]);
    // 反転していない状態は flipped を持たない形に戻す（保存 JSON を汚さない）
    expect(store().document.components[0]?.flipped).toBeUndefined();

    store().undo();
    expect(store().document.components[0]?.flipped).toBe(true);
  });

  it("複数選択はそれぞれを個別に反転する", () => {
    const power = store().addComponent(dc24vPowerSupply, { x: 0, y: 0 });
    const lamp = store().addComponent(dc24vLamp, { x: 200, y: 0 });
    store().flipComponents([power]);

    // すでに反転している電源は元へ、していないランプは反転へ
    store().flipComponents([power, lamp]);

    const flippedOf = (id: string) =>
      store().document.components.find((component) => component.id === id)
        ?.flipped;
    expect(flippedOf(power)).toBeUndefined();
    expect(flippedOf(lamp)).toBe(true);
  });

  it("配線には影響しない（端子 ID は変わらない）", () => {
    const power = store().addComponent(dc24vPowerSupply, { x: 0, y: 0 });
    const lamp = store().addComponent(dc24vLamp, { x: 200, y: 0 });
    store().addConnection({
      source: power,
      sourceHandle: "plus",
      target: lamp,
      targetHandle: "1",
    });
    const before = store().document.connections;

    store().flipComponents([power]);

    expect(store().document.connections).toEqual(before);
  });

  it("存在しない ID だけなら履歴を汚さない", () => {
    store().addComponent(dc24vPowerSupply, { x: 0, y: 0 });
    const before = store().past.length;

    store().flipComponents(["cmp-missing"]);
    store().flipComponents([]);

    expect(store().past).toHaveLength(before);
  });
});

describe("部品の交換（接続を維持したまま定義を差し替える）", () => {
  it("端子 ID が一致する交換（A接点→B接点）では配線が 1 本も切れない", () => {
    const power = store().addComponent(dc24vPowerSupply, { x: 0, y: 0 });
    const button = store().addComponent(pushbuttonNo, { x: 200, y: 0 });
    store().addConnection({
      source: power,
      sourceHandle: "plus",
      target: button,
      targetHandle: "1",
    });
    const before = store().past.length;

    store().replaceComponentDefinition(button, pushbuttonNc);

    expect(
      store().document.components.find((c) => c.id === button)?.definitionId,
    ).toBe(pushbuttonNc.id);
    expect(store().document.connections).toHaveLength(1);
    expect(store().past).toHaveLength(before + 1);

    store().undo();
    expect(
      store().document.components.find((c) => c.id === button)?.definitionId,
    ).toBe(pushbuttonNo.id);
  });

  it("接点が減る交換（MY4N→MY2N）では、無くなった端子への配線だけを間引く", () => {
    const power = store().addComponent(dc24vPowerSupply, { x: 0, y: 0 });
    const relay = store().addComponent(omronMy4nDc24, { x: 200, y: 0 });
    // MY2N でも維持される第1接点（1-5-9）と、MY2N には無くなる第2接点（2-6-10）
    store().addConnection({
      source: power,
      sourceHandle: "plus",
      target: relay,
      targetHandle: "9",
    });
    store().addConnection({
      source: power,
      sourceHandle: "zero",
      target: relay,
      targetHandle: "10",
    });
    expect(store().document.connections).toHaveLength(2);

    store().replaceComponentDefinition(relay, omronMy2nDc24);

    expect(
      store().document.components.find((c) => c.id === relay)?.definitionId,
    ).toBe(omronMy2nDc24.id);
    const remaining = store().document.connections;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.to.terminalId).toBe("9");
  });

  it("存在しない部品や同じ定義への交換は空振り（履歴を汚さない）", () => {
    const power = store().addComponent(dc24vPowerSupply, { x: 0, y: 0 });
    const before = store().past.length;

    store().replaceComponentDefinition("cmp-missing", dc24vLamp);
    store().replaceComponentDefinition(power, dc24vPowerSupply);

    expect(store().past).toHaveLength(before);
  });

  it("交換で外れた配線が選択中だったら選択からも外す", () => {
    const power = store().addComponent(dc24vPowerSupply, { x: 0, y: 0 });
    const relay = store().addComponent(omronMy4nDc24, { x: 200, y: 0 });
    store().addConnection({
      source: power,
      sourceHandle: "plus",
      target: relay,
      targetHandle: "2",
    });
    const wire = store().document.connections[0]!.id;
    store().setConnectionSelected(wire, true);

    store().replaceComponentDefinition(relay, omronMy2nDc24);

    expect(store().document.connections).toHaveLength(0);
    expect(store().selectedConnectionIds).toEqual([]);
  });
});

describe("replaceDocument", () => {
  it("読み込み前の回路へ Undo で戻れないようにする", () => {
    store().addComponent(dc24vPowerSupply, { x: 0, y: 0 });
    expect(store().past.length).toBeGreaterThan(0);

    store().replaceDocument(emptyDocument());

    expect(store().past).toHaveLength(0);
    expect(store().future).toHaveLength(0);
    expect(store().selectedComponentIds).toEqual([]);
  });
});
