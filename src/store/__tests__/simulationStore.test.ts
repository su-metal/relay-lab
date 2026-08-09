import { beforeEach, describe, expect, it } from "vitest";

import { useSimulationStore } from "@/store/simulationStore";

/**
 * 操作入力（`pressedSwitches`）の出し入れ。
 *
 * 「手を離しても状態が残るか」はエンジンではなくここで決まる（design.md §4.7）。
 * モーメンタリとオルタネートの差はこの 1 ファイルに閉じている。
 */
describe("simulationStore の操作入力", () => {
  const operated = (): string[] =>
    [...useSimulationStore.getState().pressedSwitches].sort();

  beforeEach(() => {
    useSimulationStore.getState().stop();
  });

  it("停止中の操作は溜め込まない", () => {
    useSimulationStore.getState().pressSwitch("S1");
    useSimulationStore.getState().toggleSwitch("S2");
    expect(operated()).toEqual([]);
  });

  it("モーメンタリは離すと復帰する", () => {
    const store = useSimulationStore.getState();
    store.start();
    store.pressSwitch("S1");
    expect(operated()).toEqual(["S1"]);
    store.releaseSwitch("S1");
    expect(operated()).toEqual([]);
  });

  it("オルタネートは 1 回目で ON、2 回目で OFF になる", () => {
    const store = useSimulationStore.getState();
    store.start();
    store.toggleSwitch("S1");
    expect(operated()).toEqual(["S1"]);
    // ここで OFF に戻ってしまうと押しボタンと区別が付かない
    store.toggleSwitch("S1");
    expect(operated()).toEqual([]);
  });

  it("ON 位置のオルタネートは他のスイッチを操作しても残る", () => {
    const store = useSimulationStore.getState();
    store.start();
    store.toggleSwitch("S1");
    store.pressSwitch("S2");
    expect(operated()).toEqual(["S1", "S2"]);
    store.releaseSwitch("S2");
    expect(operated()).toEqual(["S1"]);
  });

  it("停止すると ON 位置も含めてすべて解除される", () => {
    const store = useSimulationStore.getState();
    store.start();
    store.toggleSwitch("S1");
    store.stop();
    expect(operated()).toEqual([]);
    expect(useSimulationStore.getState().running).toBe(false);
  });
});
