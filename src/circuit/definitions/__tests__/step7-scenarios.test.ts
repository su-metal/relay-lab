import { describe, expect, it } from "vitest";

import { componentRegistry } from "@/circuit/definitions";
import { simulate } from "@/circuit/engine";
import type {
  CircuitConnection,
  CircuitDocument,
  SimulationResult,
} from "@/circuit/types";

/**
 * requirements.md US-F「部品が増えてもエンジンが変わらない」の実証。
 *
 * Step 7 で足した 4 部品が、**エンジンを 1 行も変えずに**期待どおり動くことを
 * 回路を組んで確かめる。判定はすべて `ComponentDefinition` の中身から出ており、
 * `simulate()` は型番を一切見ていない。
 *
 * **このファイルを `engine/__tests__/` に置かないのは意図的。** 検証しているのは
 * 定義データであってエンジンではなく、`src/circuit/engine/` の差分を 0 行に
 * 保つこと自体が Step 7 の完了判定だから（design.md §9）。
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
  pressed: string[] = [],
  previous?: SimulationResult,
): SimulationResult =>
  simulate(document, componentRegistry, {
    pressedSwitches: new Set(pressed),
    previousEnergizedRelays: previous?.energizedRelays,
  });

const energized = (result: SimulationResult): string[] =>
  [...result.energizedRelays].sort();

const POWER = "power-dc24v";
const PB_NO = "switch-pushbutton-no";
const MY2N = "omron-my2n-dc24";
const MY4N = "omron-my4n-dc24";
const MY4N_D2 = "omron-my4n-d2-dc24";
const LAMP = "lamp-dc24v";
const DIODE = "diode-generic";
const BLOCK = "terminal-block-6p";

describe("MY2N の飛び番端子で回路が組める（design.md §4.2）", () => {
  // 第2接点は 4（NC）/ 8（NO）/ 12（COM）。1〜8 に詰め直していたらこの配線は通らない
  const document = circuit(
    { PS1: POWER, S1: PB_NO, RY1: MY2N, L1: LAMP },
    [
      wire("PS1:plus", "S1:1"),
      wire("S1:2", "RY1:14"),
      wire("RY1:13", "PS1:zero"),
      wire("PS1:plus", "RY1:12"),
      wire("RY1:8", "L1:1"),
      wire("L1:2", "PS1:zero"),
    ],
  );

  it("非励磁では COM 12 が NC 4 と導通する", () => {
    const result = step(document);
    expect(result.status).toBe("stable");
    expect(result.netOf.get("RY1:12")).toBe(result.netOf.get("RY1:4"));
    expect(result.netOf.get("RY1:12")).not.toBe(result.netOf.get("RY1:8"));
    expect([...result.litLamps]).toEqual([]);
  });

  it("励磁すると 2 回路とも同時に切り替わりランプが点く", () => {
    const result = step(document, ["S1"]);
    expect(result.status).toBe("stable");
    expect(energized(result)).toEqual(["RY1"]);
    expect([...result.litLamps]).toEqual(["L1"]);
    for (const [com, no, nc] of [
      ["9", "5", "1"],
      ["12", "8", "4"],
    ]) {
      expect(result.netOf.get(`RY1:${com}`), `COM ${com}`).toBe(
        result.netOf.get(`RY1:${no}`),
      );
      expect(result.netOf.get(`RY1:${com}`), `COM ${com}`).not.toBe(
        result.netOf.get(`RY1:${nc}`),
      );
    }
  });

  it("存在しない端子番号（2・3・6・7・10・11）を持たない", () => {
    const result = step(document);
    for (const missing of ["2", "3", "6", "7", "10", "11"]) {
      expect(result.netOf.has(`RY1:${missing}`), missing).toBe(false);
    }
  });
});

describe("MY4N-D2 の極性厳守（design.md §4.3・§5.3）", () => {
  const reversed = (definitionId: string) =>
    circuit({ PS1: POWER, RY1: definitionId }, [
      // コイル + の 14 を 0V へ、− の 13 を +24V へ繋いだ逆接
      wire("PS1:zero", "RY1:14"),
      wire("RY1:13", "PS1:plus"),
    ]);

  it("順接では励磁し、警告も出ない", () => {
    const document = circuit({ PS1: POWER, RY1: MY4N_D2 }, [
      wire("PS1:plus", "RY1:14"),
      wire("RY1:13", "PS1:zero"),
    ]);
    const result = step(document);
    expect(energized(result)).toEqual(["RY1"]);
    expect(
      result.warnings.filter((w) => w.code === "coil-polarity-reversed"),
    ).toEqual([]);
  });

  it("逆接では励磁せず error になる", () => {
    const result = step(reversed(MY4N_D2));
    expect(energized(result)).toEqual([]);
    const warning = result.warnings.find(
      (w) => w.code === "coil-polarity-reversed",
    );
    expect(warning?.severity).toBe("error");
    expect(warning?.componentId).toBe("RY1");
  });

  it("同じ逆接でも MY4N は励磁し warning に留まる", () => {
    const result = step(reversed(MY4N));
    // "indicator" なので励磁はする。表示灯が点かないだけ
    expect(energized(result)).toEqual(["RY1"]);
    expect(
      result.warnings.find((w) => w.code === "coil-polarity-reversed")
        ?.severity,
    ).toBe("warning");
  });

  it("MY2N も MY4N と同じく逆接で励磁する", () => {
    const result = step(reversed(MY2N));
    expect(energized(result)).toEqual(["RY1"]);
  });
});

describe("端子台は全端子が常時導通する（design.md §5.1）", () => {
  const document = circuit(
    { PS1: POWER, TB1: BLOCK, L1: LAMP, L2: LAMP },
    [
      // +24V を端子 1 に入れ、端子 2 / 4 から 2 系統へ分岐する
      wire("PS1:plus", "TB1:1"),
      wire("TB1:2", "L1:1"),
      wire("TB1:4", "L2:1"),
      wire("L1:2", "PS1:zero"),
      wire("L2:2", "PS1:zero"),
    ],
  );

  it("1 端子に入れた電位が 6 端子すべてに回る", () => {
    const result = step(document);
    expect(result.status).toBe("stable");
    const net = result.netOf.get("TB1:1");
    for (const id of ["2", "3", "4", "5", "6"]) {
      expect(result.netOf.get(`TB1:${id}`), id).toBe(net);
    }
  });

  it("分岐した 2 系統のランプが両方点灯する", () => {
    const result = step(document);
    expect([...result.litLamps].sort()).toEqual(["L1", "L2"]);
  });

  it("端子台は導線なので、+24V と 0V を渡すと短絡になる", () => {
    const shorted = circuit({ PS1: POWER, TB1: BLOCK }, [
      wire("PS1:plus", "TB1:1"),
      wire("PS1:zero", "TB1:6"),
    ]);
    const result = step(shorted);
    expect(
      result.warnings.find((w) => w.code === "power-short-circuit")?.severity,
    ).toBe("error");
  });
});

describe("ダイオードは MVP では常に開放（design.md §5.4）", () => {
  const document = circuit({ PS1: POWER, D1: DIODE, L1: LAMP }, [
    // +24V → アノード → カソード → ランプ → 0V。順方向に繋いでも通さない
    wire("PS1:plus", "D1:a"),
    wire("D1:k", "L1:1"),
    wire("L1:2", "PS1:zero"),
  ]);

  it("順方向でも 2 端子は union されずランプは点かない", () => {
    const result = step(document);
    expect(result.status).toBe("stable");
    expect(result.netOf.get("D1:a")).not.toBe(result.netOf.get("D1:k"));
    expect([...result.litLamps]).toEqual([]);
  });

  it("電源に直結しても短絡と判定されない（負荷と同じ扱い）", () => {
    const across = circuit({ PS1: POWER, D1: DIODE }, [
      wire("PS1:plus", "D1:a"),
      wire("D1:k", "PS1:zero"),
    ]);
    const result = step(across);
    expect(
      result.warnings.filter((w) => w.code === "power-short-circuit"),
    ).toEqual([]);
  });
});
