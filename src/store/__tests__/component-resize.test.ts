import { beforeEach, describe, expect, it } from "vitest";

import { dc24vPowerSupply } from "@/circuit/definitions";
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

describe("部品のリサイズ", () => {
  it("ドラッグ中の更新を履歴1手にまとめ、Undoで寸法と位置を戻す", () => {
    const id = store().addComponent(dc24vPowerSupply, { x: 100, y: 80 });
    const historyAfterAdd = store().past.length;

    store().beginComponentResize();
    store().resizeComponent(id, {
      x: 80,
      y: 60,
      width: dc24vPowerSupply.visual.width + 80,
      height: dc24vPowerSupply.visual.height + 40,
    });
    store().resizeComponent(id, {
      x: 60,
      y: 40,
      width: dc24vPowerSupply.visual.width + 120,
      height: dc24vPowerSupply.visual.height + 70,
    });
    store().endComponentResize();

    expect(store().past).toHaveLength(historyAfterAdd + 1);
    expect(store().document.components[0]).toMatchObject({
      position: { x: 60, y: 40 },
      size: {
        width: dc24vPowerSupply.visual.width + 120,
        height: dc24vPowerSupply.visual.height + 70,
      },
    });

    store().undo();
    expect(store().document.components[0]?.position).toEqual({ x: 100, y: 80 });
    expect(store().document.components[0]?.size).toBeUndefined();
  });

  it("型番の既定寸法より小さくはできない", () => {
    const id = store().addComponent(dc24vPowerSupply, { x: 0, y: 0 });

    store().beginComponentResize();
    store().resizeComponent(id, {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
    store().endComponentResize();

    // 既定寸法と同じ状態は size を保存しない。表示側は visual 寸法へ戻る。
    expect(store().document.components[0]?.size).toBeUndefined();
  });

  it("掴んだだけで寸法が変わらなければ履歴を積まない", () => {
    store().addComponent(dc24vPowerSupply, { x: 0, y: 0 });
    const before = store().past.length;

    store().beginComponentResize();
    store().endComponentResize();

    expect(store().past).toHaveLength(before);
  });
});
