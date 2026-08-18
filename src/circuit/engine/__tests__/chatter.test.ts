/**
 * 自分の接点で自分のコイルを切る配線の検出（design.md §5.14）。
 *
 * **出ないこと**が出ることと同じだけ大事になる検査。自己保持回路は
 * 「自分の a 接点でコイルを保持する」正しい配線であり、ここと 1 歩しか
 * 違わない。誤検出すると、教科書どおりの回路に警告が出ることになる。
 */

import { describe, expect, it } from "vitest";

import { componentRegistry } from "@/circuit/definitions";
import { simulate } from "@/circuit/engine";
import type {
  CircuitConnection,
  CircuitDocument,
  Warning,
} from "@/circuit/types";

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

const chatterWarnings = (
  document: CircuitDocument,
  pressed: readonly string[],
  previousEnergizedRelays?: ReadonlySet<string>,
): Warning[] =>
  simulate(document, componentRegistry, {
    pressedSwitches: new Set(pressed),
    previousEnergizedRelays,
  }).warnings.filter((warning) => warning.code === "coil-self-interrupt");

const PARTS = {
  PS1: "power-dc24v",
  SW: "switch-selector-no",
  RY1: "omron-my2n-dc24",
};

/** コイル −（13）は常に 0V へ落とす */
const COIL_NEGATIVE = wire("RY1:13", "PS1:zero");

describe("detectSelfInterruptingCoils（design.md §5.14）", () => {
  it("起動経路が自分の b 接点を通っていると警告する", () => {
    // +24V → SW → 12 →[自分の b 接点]→ 4 → コイル 14
    const document = circuit(PARTS, [
      wire("PS1:plus", "SW:1"),
      wire("SW:2", "RY1:12"),
      wire("RY1:4", "RY1:14"),
      COIL_NEGATIVE,
    ]);

    const warnings = chatterWarnings(document, ["SW"]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe("warning");
    expect(warnings[0].componentId).toBe("RY1");
    // どの接点が効いているかを端子番号で名指しする
    expect(warnings[0].message).toContain("端子 12–4");
  });

  it("自己保持の a 接点が別にあっても警告は消えない（実機は唸る）", () => {
    // 上に自己保持（9–5）を足した形。収束計算は stable と答えるが実機は唸る
    const document = circuit(PARTS, [
      wire("PS1:plus", "SW:1"),
      wire("SW:2", "RY1:12"),
      wire("RY1:4", "RY1:14"),
      wire("PS1:plus", "RY1:9"),
      wire("RY1:5", "RY1:14"),
      COIL_NEGATIVE,
    ]);

    const result = simulate(document, componentRegistry, {
      pressedSwitches: new Set(["SW"]),
    });
    // 安定解としては何の矛盾も無い —— だから収束計算では見つからない
    expect(result.status).toBe("stable");
    expect(result.energizedRelays.has("RY1")).toBe(true);
    expect(
      result.warnings.filter((w) => w.code === "coil-self-interrupt"),
    ).toHaveLength(1);
  });

  it("ふつうの自己保持回路には出ない（自分の a 接点で保持するのは正しい）", () => {
    // 起動は外部スイッチ、保持は自分の a 接点（9–5）。b 接点を通らない
    const document = circuit(PARTS, [
      wire("PS1:plus", "SW:1"),
      wire("SW:2", "RY1:14"),
      wire("PS1:plus", "RY1:9"),
      wire("RY1:5", "RY1:14"),
      COIL_NEGATIVE,
    ]);

    expect(chatterWarnings(document, ["SW"])).toEqual([]);
    // 保持に入ったあと（スイッチを戻した状態）も出ない
    const held = simulate(document, componentRegistry, {
      pressedSwitches: new Set(["SW"]),
    });
    expect(chatterWarnings(document, [], held.energizedRelays)).toEqual([]);
  });

  it("他のリレーの b 接点を通る配線には出ない（インターロックは正しい）", () => {
    const document = circuit(
      { ...PARTS, RY2: "omron-my2n-dc24" },
      [
        wire("PS1:plus", "SW:1"),
        // RY1 の起動は RY2 の b 接点を通る。自分の接点ではない
        wire("SW:2", "RY2:12"),
        wire("RY2:4", "RY1:14"),
        COIL_NEGATIVE,
        wire("RY2:13", "PS1:zero"),
      ],
    );

    expect(chatterWarnings(document, ["SW"])).toEqual([]);
  });

  it("スイッチを入れていなければ出ない（吸引しないので唸らない）", () => {
    const document = circuit(PARTS, [
      wire("PS1:plus", "SW:1"),
      wire("SW:2", "RY1:12"),
      wire("RY1:4", "RY1:14"),
      COIL_NEGATIVE,
    ]);

    expect(chatterWarnings(document, [])).toEqual([]);
  });

  it("コイル − 側が自分の b 接点を通る場合も検出する", () => {
    // + 側は直結、0V へ戻る側を自分の b 接点に通した鏡像の配線
    const document = circuit(PARTS, [
      wire("PS1:plus", "SW:1"),
      wire("SW:2", "RY1:14"),
      wire("RY1:13", "RY1:12"),
      wire("RY1:4", "PS1:zero"),
    ]);

    const warnings = chatterWarnings(document, ["SW"]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("端子 12–4");
  });

  it("タイマーには出ない（限時があるとフリッカ回路になり唸りではない）", () => {
    const document = circuit(
      { PS1: "power-dc24v", SW: "switch-selector-no", TM1: "timer-on-delay" },
      [
        // 入力（コイル）は 1–2、限時接点は COM 3 / a 4 / b 5
        wire("PS1:plus", "SW:1"),
        wire("SW:2", "TM1:3"),
        wire("TM1:5", "TM1:1"),
        wire("TM1:2", "PS1:zero"),
      ],
    );

    expect(chatterWarnings(document, ["SW"])).toEqual([]);
  });
});
