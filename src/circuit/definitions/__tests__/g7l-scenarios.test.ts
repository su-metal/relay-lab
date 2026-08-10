import { describe, expect, it } from "vitest";

import { componentRegistry } from "@/circuit/definitions";
import { simulate } from "@/circuit/engine";
import type {
  CircuitConnection,
  CircuitDocument,
  SimulationResult,
} from "@/circuit/types";

/**
 * G7L（a 接点のみのパワーリレー）を実際に配線して動かす検証（design.md §4.8）。
 *
 * 押さえたいのは 3 点。
 *
 * 1. **非励磁で接点がどこにも閉じない。** c 接点の「COM は必ずどちらかへ倒れる」を
 *    a 接点に当てはめると、実機に無い b 接点が生える（design.md §5.1）
 * 2. **1 極形の飛び番。** 端子は 4・6 であって 2・4 ではない。詰め直していたら
 *    この配線は通らない（requirements.md US-F）
 * 3. **コイルに極性が無い。** 逆向きに繋いでも励磁し、警告も出ない
 *
 * `step7-scenarios.test.ts` と同じく `engine/__tests__/` には置かない。
 * 検証対象は定義データであってエンジンではない（design.md §4.6）。
 */

/** "RY1:0" のような "インスタンスID:端子ID" 記法で配線する */
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
  pressed: string[] = [],
): SimulationResult =>
  simulate(document, componentRegistry, {
    pressedSwitches: new Set(pressed),
  });

const POWER = "power-dc24v";
const PB_NO = "switch-pushbutton-no";
const LAMP = "lamp-dc24v";
const G7L_1A = "omron-g7l-1a-b-dc24";
const G7L_2A = "omron-g7l-2a-b-dc24";

describe("G7L-2A-B の 2 極を押しボタンで開閉する（design.md §4.8）", () => {
  // +24V → S1 → コイル 0 / 1 → 0V。接点は 2–4 と 6–8 でランプを 2 個点ける
  const document = circuit({ PS1: POWER, S1: PB_NO, RY1: G7L_2A, L1: LAMP, L2: LAMP }, [
    wire("PS1:plus", "S1:1"),
    wire("S1:2", "RY1:0"),
    wire("RY1:1", "PS1:zero"),
    wire("PS1:plus", "RY1:2"),
    wire("RY1:4", "L1:1"),
    wire("L1:2", "PS1:zero"),
    wire("PS1:plus", "RY1:6"),
    wire("RY1:8", "L2:1"),
    wire("L2:2", "PS1:zero"),
  ]);

  /**
   * **本ファイルの主眼。** a 接点なので非励磁では 2–4 も 6–8 も繋がらない。
   * ここが繋がっていたら、b 接点を持たないリレーに b 接点を生やしている。
   */
  it("非励磁ではどの極も導通せず、ランプは点かない", () => {
    const result = step(document);

    expect(result.status).toBe("stable");
    expect([...result.energizedRelays]).toEqual([]);
    expect(result.netOf.get("RY1:2")).not.toBe(result.netOf.get("RY1:4"));
    expect(result.netOf.get("RY1:6")).not.toBe(result.netOf.get("RY1:8"));
    expect([...result.litLamps]).toEqual([]);
  });

  it("励磁すると 2 極が同時に閉じ、ランプが 2 個とも点く", () => {
    const result = step(document, ["S1"]);

    expect(result.status).toBe("stable");
    expect([...result.energizedRelays]).toEqual(["RY1"]);
    expect(result.netOf.get("RY1:2")).toBe(result.netOf.get("RY1:4"));
    expect(result.netOf.get("RY1:6")).toBe(result.netOf.get("RY1:8"));
    expect([...result.litLamps].sort()).toEqual(["L1", "L2"]);
  });

  it("極どうしはリレー内部で繋がらない", () => {
    // 上の回路では両極が電源で合流してしまうので、配線せずに単体で見る
    const alone = step(circuit({ RY1: G7L_2A }, []));
    expect(alone.netOf.get("RY1:2")).not.toBe(alone.netOf.get("RY1:6"));
    expect(alone.netOf.get("RY1:4")).not.toBe(alone.netOf.get("RY1:8"));
  });

  it("奇数番号の接点端子（3・5・7）は存在しない", () => {
    const result = step(document);
    for (const missing of ["3", "5", "7"]) {
      expect(result.netOf.has(`RY1:${missing}`), missing).toBe(false);
    }
  });
});

describe("G7L-1A-B の飛び番（design.md §4.8）", () => {
  // 接点は 4–6。2 極形の 1 行目（2–4）ではない
  const document = circuit({ PS1: POWER, S1: PB_NO, RY1: G7L_1A, L1: LAMP }, [
    wire("PS1:plus", "S1:1"),
    wire("S1:2", "RY1:0"),
    wire("RY1:1", "PS1:zero"),
    wire("PS1:plus", "RY1:4"),
    wire("RY1:6", "L1:1"),
    wire("L1:2", "PS1:zero"),
  ]);

  it("接点端子 4–6 で配線でき、励磁で閉じる", () => {
    expect([...step(document).litLamps]).toEqual([]);

    const result = step(document, ["S1"]);
    expect([...result.energizedRelays]).toEqual(["RY1"]);
    expect(result.netOf.get("RY1:4")).toBe(result.netOf.get("RY1:6"));
    expect([...result.litLamps]).toEqual(["L1"]);
  });

  /**
   * 2 極形の 2 と 8 は 1 極形には無い。ここを「1 極なら 2–4」と
   * 詰め直していたら、この期待は落ちる（本プロダクトの価値の中核）。
   */
  it("2 極形の端子 2・8 は存在しない", () => {
    const result = step(document);
    expect(result.netOf.has("RY1:2")).toBe(false);
    expect(result.netOf.has("RY1:8")).toBe(false);
    expect(result.netOf.has("RY1:4")).toBe(true);
    expect(result.netOf.has("RY1:6")).toBe(true);
  });
});

describe("G7L のコイルは極性を持たない（design.md §4.8・§5.3）", () => {
  const forward = circuit({ PS1: POWER, RY1: G7L_2A }, [
    wire("PS1:plus", "RY1:0"),
    wire("RY1:1", "PS1:zero"),
  ]);
  // 0 と 1 を入れ替えただけ。カタログに「コイル極性はありません」とある以上、
  // これも正しい使い方であって警告する筋合いは無い
  const swapped = circuit({ PS1: POWER, RY1: G7L_2A }, [
    wire("PS1:zero", "RY1:0"),
    wire("RY1:1", "PS1:plus"),
  ]);

  it("どちら向きに繋いでも励磁し、極性の警告も出ない", () => {
    for (const [name, document] of [
      ["順", forward],
      ["逆", swapped],
    ] as const) {
      const result = step(document);
      expect([...result.energizedRelays], name).toEqual(["RY1"]);
      expect(
        result.warnings.filter((w) => w.code === "coil-polarity-reversed"),
        name,
      ).toEqual([]);
    }
  });
});
