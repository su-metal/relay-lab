/**
 * 電流の向きの検証（design.md §5.10）。
 *
 * 守りたいのは 3 つ。
 *
 * 1. **向きは配線を引いた順序に依存しない。** 同じ回路を逆向きに配線しても、
 *    電流の向きは電源とコイルの位置だけで決まる
 * 2. **向きは定義上のコイル + 端子に依存しない。** 極性なしのコイルを逆接した
 *    回路では、13 番が電流の入口になる（design.md §5.3）
 * 3. **並列に分かれた区間には向きを出さない。** 実際に分流するので
 *    1 本に決まらない。誤った向きを描くくらいなら描かない
 */

import { describe, expect, it } from "vitest";

import { buildCurrentFlow } from "@/circuit/adapter/current-flow";
import { componentRegistry } from "@/circuit/definitions";
import { simulate } from "@/circuit/engine";
import type { CircuitConnection, CircuitDocument } from "@/circuit/types";

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

const POWER = "power-dc24v";
const PB_NO = "switch-pushbutton-no";
const MY4N = "omron-my4n-dc24";
const MY2N = "omron-my2n-dc24";
const BLOCK = "terminal-block-6p";

/** 押した状態で解いて、そのときの電流の向きを返す */
const flowOf = (doc: CircuitDocument, pressed: string[] = []) => {
  const pressedSwitches = new Set(pressed);
  const result = simulate(doc, componentRegistry, { pressedSwitches });
  return {
    result,
    flow: buildCurrentFlow(doc, componentRegistry, result, pressedSwitches),
  };
};

describe("buildCurrentFlow", () => {
  /** +24V → 起動ボタン → コイル 14 / コイル 13 → 0V の素直な回路 */
  const straight = circuit({ PS1: POWER, S1: PB_NO, RY1: MY4N }, [
    wire("PS1:plus", "S1:1"),
    wire("S1:2", "RY1:14"),
    wire("RY1:13", "PS1:zero"),
  ]);

  it("停止中（result が null）は向きを持たない", () => {
    const flow = buildCurrentFlow(
      straight,
      componentRegistry,
      null,
      new Set(),
    );
    expect(flow.directionOf.size).toBe(0);
  });

  it("非励磁のときは向きを持たない（電流が流れていないので）", () => {
    const { result, flow } = flowOf(straight);
    expect(result.energizedRelays.size).toBe(0);
    expect(flow.directionOf.size).toBe(0);
  });

  it("+ 側からコイルへ、コイルから 0V へ向きが付く", () => {
    const { result, flow } = flowOf(straight, ["S1"]);

    expect([...result.energizedRelays]).toEqual(["RY1"]);
    // どれも from 側が電流の上流になるように引いてある
    expect(flow.directionOf.get("PS1:plus-S1:1")).toBe("forward");
    expect(flow.directionOf.get("S1:2-RY1:14")).toBe("forward");
    expect(flow.directionOf.get("RY1:13-PS1:zero")).toBe("forward");
  });

  it("配線を逆向きに引いても電流の向きは変わらない", () => {
    /*
     * `straight` とまったく同じ回路を、3 本とも逆向きに引いたもの。
     * 配線に電気的な向きは無いので、電流の向きだけが逆の符号で出るはず。
     */
    const reversedWiring = circuit({ PS1: POWER, S1: PB_NO, RY1: MY4N }, [
      wire("S1:1", "PS1:plus"),
      wire("RY1:14", "S1:2"),
      wire("PS1:zero", "RY1:13"),
    ]);
    const { flow } = flowOf(reversedWiring, ["S1"]);

    expect(flow.directionOf.get("S1:1-PS1:plus")).toBe("backward");
    expect(flow.directionOf.get("RY1:14-S1:2")).toBe("backward");
    expect(flow.directionOf.get("PS1:zero-RY1:13")).toBe("backward");
  });

  it("極性なしのコイルを逆接すると、13 番が電流の入口になる", () => {
    /*
     * MY2N は `polarity: "none"` で逆接でも励磁する（design.md §5.3）。
     * 定義上の positiveTerminal（14）を入口と決め打っていたら、
     * ここで向きが丸ごと逆に出る。
     */
    const reversedCoil = circuit({ PS1: POWER, S1: PB_NO, RY1: MY2N }, [
      wire("PS1:plus", "S1:1"),
      wire("S1:2", "RY1:13"),
      wire("RY1:14", "PS1:zero"),
    ]);
    const { result, flow } = flowOf(reversedCoil, ["S1"]);

    expect([...result.energizedRelays]).toEqual(["RY1"]);
    expect(flow.directionOf.get("S1:2-RY1:13")).toBe("forward");
    expect(flow.directionOf.get("RY1:14-PS1:zero")).toBe("forward");
  });

  it("並列に分かれた区間には向きを出さない", () => {
    /*
     * +24V からコイル 14 へ、端子台を経由する道と直結する道の 2 通り。
     * どちらにも分流するので「こちらへ流れる」と言えない。
     * 一方、帰り道（13 → 0V）は 1 本しかないので向きが付く。
     */
    const parallel = circuit({ PS1: POWER, TB1: BLOCK, RY1: MY4N }, [
      wire("PS1:plus", "TB1:1"),
      wire("TB1:4", "RY1:14"),
      wire("PS1:plus", "RY1:14"),
      wire("RY1:13", "PS1:zero"),
    ]);
    const { result, flow } = flowOf(parallel);

    expect([...result.energizedRelays]).toEqual(["RY1"]);
    expect(flow.directionOf.has("PS1:plus-TB1:1")).toBe(false);
    expect(flow.directionOf.has("TB1:4-RY1:14")).toBe(false);
    expect(flow.directionOf.has("PS1:plus-RY1:14")).toBe(false);
    expect(flow.directionOf.get("RY1:13-PS1:zero")).toBe("forward");
  });

  it("通電していない枝には向きが付かない", () => {
    /*
     * 起動ボタンを押してコイルは励磁しているが、第1接点 NO(5) の先の
     * ランプへは COM(9) に何も来ていないので電流が流れない。
     */
    const withDeadBranch = circuit(
      { PS1: POWER, S1: PB_NO, RY1: MY4N, L1: "lamp-dc24v" },
      [
        wire("PS1:plus", "S1:1"),
        wire("S1:2", "RY1:14"),
        wire("RY1:13", "PS1:zero"),
        wire("RY1:5", "L1:1"),
        wire("L1:2", "PS1:zero"),
      ],
    );
    const { result, flow } = flowOf(withDeadBranch, ["S1"]);

    expect(result.litLamps.size).toBe(0);
    expect(flow.directionOf.has("RY1:5-L1:1")).toBe(false);
    expect(flow.directionOf.has("L1:2-PS1:zero")).toBe(false);
    expect(flow.directionOf.get("S1:2-RY1:14")).toBe("forward");
  });

  it("接点を閉じてランプが点くと、その枝にも向きが付く", () => {
    const lampCircuit = circuit(
      { PS1: POWER, S1: PB_NO, RY1: MY4N, L1: "lamp-dc24v" },
      [
        wire("PS1:plus", "S1:1"),
        wire("S1:2", "RY1:14"),
        wire("RY1:13", "PS1:zero"),
        // COM(9) に +24V を入れ、NO(5) の先にランプを吊る
        wire("PS1:plus", "RY1:9"),
        wire("RY1:5", "L1:1"),
        wire("L1:2", "PS1:zero"),
      ],
    );
    const { result, flow } = flowOf(lampCircuit, ["S1"]);

    expect([...result.litLamps]).toEqual(["L1"]);
    expect(flow.directionOf.get("PS1:plus-RY1:9")).toBe("forward");
    expect(flow.directionOf.get("RY1:5-L1:1")).toBe("forward");
    expect(flow.directionOf.get("L1:2-PS1:zero")).toBe("forward");
  });
});
