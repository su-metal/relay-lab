import { describe, expect, it } from "vitest";

import { componentRegistry } from "@/circuit/definitions";
import { simulate } from "@/circuit/engine";
import type {
  CircuitConnection,
  CircuitDocument,
  SimulationResult,
  Warning,
} from "@/circuit/types";

/**
 * 逆起電力吸収（還流）ダイオードの再現（design.md §5.4）。
 *
 * リレーコイルは誘導負荷で、消磁の瞬間に電源電圧の数十倍の逆起電力を出す。
 * これを吸収するのがコイルと**並列**に入れるダイオードで、向きは
 * 「カソードをコイルの + 側へ」。**逆に挿すと通電中ずっと順方向になり、
 * コイルと並列の短絡経路になって焼損する** —— この差を出せることが
 * 「実機を配線する前の確認」というプロダクト価値そのものなので、
 * 向きの誤りは接点が開いていて今は電流が流れていなくても警告する。
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
): SimulationResult =>
  simulate(document, componentRegistry, { pressedSwitches: new Set(pressed) });

const errorsOf = (result: SimulationResult): Warning[] =>
  result.warnings.filter((warning) => warning.severity === "error");

const POWER = "power-dc24v";
const PB_NO = "switch-pushbutton-no";
const MY4N = "omron-my4n-dc24";
const DIODE = "diode-generic";

/**
 * +24V → S1 → RY1 のコイル（14 が +、13 が −）→ 0V に、
 * コイルと並列のダイオードを 1 本足す。`toCoilPlus` にコイルの + 側（14）へ
 * 向ける端子を渡す —— `"k"` が正しい向き、`"a"` が逆挿し。
 */
const withFlyback = (toCoilPlus: "a" | "k") =>
  circuit({ PS1: POWER, S1: PB_NO, RY1: MY4N, D1: DIODE }, [
    wire("PS1:plus", "S1:1"),
    wire("S1:2", "RY1:14"),
    wire("RY1:13", "PS1:zero"),
    wire(`D1:${toCoilPlus}`, "RY1:14"),
    wire(`D1:${toCoilPlus === "k" ? "a" : "k"}`, "RY1:13"),
  ]);

describe("正しい向き（カソードがコイルの + 側）", () => {
  const document = withFlyback("k");

  it("回路の動作を一切変えない（逆バイアスなので開いている）", () => {
    expect([...step(document).energizedRelays]).toEqual([]);

    const pressed = step(document, ["S1"]);
    expect(pressed.status).toBe("stable");
    expect([...pressed.energizedRelays]).toEqual(["RY1"]);
  });

  it("通電中でも警告を出さない", () => {
    expect(errorsOf(step(document, ["S1"]))).toEqual([]);
    expect(
      step(document, ["S1"]).warnings.filter(
        (warning) => warning.code === "diode-reversed",
      ),
    ).toEqual([]);
  });
});

describe("逆挿し（アノードがコイルの + 側）", () => {
  const document = withFlyback("a");

  it("押しボタンを押していなくても向きの誤りとして警告する", () => {
    // 静止状態では S1 が開いていて電流が流れないが、配線としては既に誤り
    const result = step(document);
    const warning = result.warnings.find((w) => w.code === "diode-reversed");
    expect(warning?.severity).toBe("error");
    expect(warning?.componentId).toBe("D1");
    expect(warning?.message).toContain("RY1");
  });

  it("通電するとコイルと並列の短絡経路になり、リレーが励磁しない", () => {
    const result = step(document, ["S1"]);
    expect(result.status).toBe("stable");
    expect([...result.energizedRelays]).toEqual([]);
    expect(
      result.warnings.find((w) => w.code === "power-short-circuit")?.severity,
    ).toBe("error");
  });

  it("コイル + 側のネットが短絡（+ と 0V の両方に到達）になる", () => {
    const result = step(document, ["S1"]);
    const netId = result.netOf.get("RY1:14");
    expect(netId).toBeDefined();
    expect(result.netState.get(netId as number)).toEqual({
      reachesPlus: true,
      reachesZero: true,
    });
  });
});

describe("コイルと並列でないダイオードは還流ダイオードとして扱わない", () => {
  it("コイルと直列に順方向で入れても警告は出ず、リレーは励磁する", () => {
    const document = circuit({ PS1: POWER, RY1: MY4N, D1: DIODE }, [
      wire("PS1:plus", "D1:a"),
      wire("D1:k", "RY1:14"),
      wire("RY1:13", "PS1:zero"),
    ]);
    const result = step(document);
    expect([...result.energizedRelays]).toEqual(["RY1"]);
    expect(errorsOf(result)).toEqual([]);
  });

  it("コイルと直列に逆向きで入れると励磁しない（遮断・警告はしない）", () => {
    const document = circuit({ PS1: POWER, RY1: MY4N, D1: DIODE }, [
      wire("PS1:plus", "D1:k"),
      wire("D1:a", "RY1:14"),
      wire("RY1:13", "PS1:zero"),
    ]);
    const result = step(document);
    expect([...result.energizedRelays]).toEqual([]);
    // 逆流防止として意図的に入れる配線と区別できないため警告しない
    expect(errorsOf(result)).toEqual([]);
  });
});

describe("直列につないだ 2 本のダイオードも電位を伝える", () => {
  it("+24V → D1 → D2 → ランプ → 0V でランプが点く", () => {
    const document = circuit(
      { PS1: POWER, D1: DIODE, D2: DIODE, L1: "lamp-dc24v" },
      [
        wire("PS1:plus", "D1:a"),
        wire("D1:k", "D2:a"),
        wire("D2:k", "L1:1"),
        wire("L1:2", "PS1:zero"),
      ],
    );
    expect([...step(document).litLamps]).toEqual(["L1"]);
  });
});
