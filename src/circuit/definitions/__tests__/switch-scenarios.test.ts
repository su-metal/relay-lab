import { describe, expect, it } from "vitest";

import { componentRegistry } from "@/circuit/definitions";
import { simulate } from "@/circuit/engine";
import type {
  CircuitConnection,
  CircuitDocument,
  SimulationResult,
} from "@/circuit/types";

/**
 * 切替スイッチ（オルタネート）の挙動（design.md §4.7）。
 *
 * オルタネートは `action: "maintained"` という定義データの 1 値でしかなく、
 * **`src/circuit/engine/` の差分は 0 行**（requirements.md US-F と同じ主張）。
 * エンジンから見ればモーメンタリと同じ「操作されているか」の 1 ビットで、
 * 手を離しても状態が残るかどうかは `simulationStore` 側の責務になる。
 * ここで確かめるのは定義データとして正しく回路に載ることまで。
 */

/** "RY1:14" のような "インスタンスID:端子ID" 記法で配線する */
const wire = (from: string, to: string): CircuitConnection => {
  const [fromComponent, fromTerminal] = from.split(":");
  const [toComponent, toTerminal] = to.split(":");
  return {
    id: `${from}-${to}`,
    from: { componentId: fromComponent, terminalId: fromTerminal },
    to: { componentId: toComponent, terminalId: toTerminal },
  };
};

const circuit = (
  components: Record<string, string>,
  connections: CircuitConnection[],
): CircuitDocument => ({
  version: 1,
  components: Object.entries(components).map(([id, definitionId]) => ({
    id,
    definitionId,
    label: id,
    position: { x: 0, y: 0 },
  })),
  connections,
  viewport: { x: 0, y: 0, zoom: 1 },
});

const step = (
  document: CircuitDocument,
  operated: string[] = [],
  previous?: SimulationResult,
): SimulationResult =>
  simulate(document, componentRegistry, {
    pressedSwitches: new Set(operated),
    previousEnergizedRelays: previous?.energizedRelays,
  });

const POWER = "power-dc24v";
const SELECTOR_NO = "switch-selector-no";
const SELECTOR_NC = "switch-selector-nc";
const MY4N = "omron-my4n-dc24";

describe("切替スイッチ A接点（オルタネート）", () => {
  // +24V → S1(1-2) → コイル 14 / コイル 13 → 0V。自己保持の配線は組まない
  const document = circuit({ PS1: POWER, S1: SELECTOR_NO, RY1: MY4N }, [
    wire("PS1:plus", "S1:1"),
    wire("S1:2", "RY1:14"),
    wire("RY1:13", "PS1:zero"),
  ]);

  it("OFF 位置では励磁しない", () => {
    expect([...step(document).energizedRelays]).toEqual([]);
  });

  it("ON 位置の間ずっと励磁する", () => {
    const on = step(document, ["S1"]);
    expect([...on.energizedRelays]).toEqual(["RY1"]);

    /**
     * **オルタネートの本質はここ。** 自己保持回路を組んでいないのに、
     * 操作集合に残っている限り次のステップでも励磁が続く。
     * モーメンタリなら手を離した時点で操作集合から抜け、ここで落ちる。
     */
    const stillOn = step(document, ["S1"], on);
    expect([...stillOn.energizedRelays]).toEqual(["RY1"]);
  });

  it("OFF 位置へ戻せば消磁する", () => {
    const on = step(document, ["S1"]);
    expect([...step(document, [], on).energizedRelays]).toEqual([]);
  });
});

describe("切替スイッチ B接点（オルタネート）", () => {
  const document = circuit({ PS1: POWER, S1: SELECTOR_NC, RY1: MY4N }, [
    wire("PS1:plus", "S1:1"),
    wire("S1:2", "RY1:14"),
    wire("RY1:13", "PS1:zero"),
  ]);

  it("OFF 位置では導通しており励磁する", () => {
    expect([...step(document).energizedRelays]).toEqual(["RY1"]);
  });

  it("ON 位置にすると開いたまま留まり、消磁が続く", () => {
    const off = step(document, ["S1"]);
    expect([...off.energizedRelays]).toEqual([]);
    expect([...step(document, ["S1"], off).energizedRelays]).toEqual([]);
  });
});
