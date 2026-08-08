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

import { dc24vLamp, dc24vPowerSupply } from "@/circuit/definitions";
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
