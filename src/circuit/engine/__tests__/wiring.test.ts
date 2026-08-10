/**
 * 静的な配線チェック（design.md §5.7）。
 *
 * 「電源を入れる前に分かることだけを出す」が仕様なので、
 * **出ること**と同じくらい **出ないこと** が大事になる。
 */

import { describe, expect, it } from "vitest";

import { componentRegistry } from "@/circuit/definitions";
import { inspectWiring } from "@/circuit/engine";
import type {
  CircuitConnection,
  CircuitDocument,
  WarningCode,
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

const check = (document: CircuitDocument) =>
  inspectWiring(document, componentRegistry);

const codes = (document: CircuitDocument): WarningCode[] => [
  ...new Set(check(document).map((warning) => warning.code)),
];

const POWER = "power-dc24v";
const PB_NO = "switch-pushbutton-no";
const PB_NC = "switch-pushbutton-nc";
const MY4N = "omron-my4n-dc24";
const DIODE = "diode-generic";
const LAMP = "lamp-dc24v";

describe("未接続の端子（通電を見ない指摘）", () => {
  it("配線していない端子をすべて挙げる", () => {
    const document = circuit({ PS1: POWER }, []);
    const warnings = check(document);

    expect(warnings).toHaveLength(2);
    expect(warnings.every((w) => w.code === "unconnected-terminal")).toBe(true);
    expect(warnings.every((w) => w.severity === "info")).toBe(true);
  });

  it("繋いだ端子は出ない", () => {
    const document = circuit({ PS1: POWER, TB1: "terminal-block-6p" }, [
      wire("PS1:plus", "TB1:1"),
    ]);

    const unconnected = check(document).filter(
      (warning) => warning.componentId === "PS1",
    );
    expect(unconnected).toHaveLength(1);
    expect(unconnected[0].terminalId).toBe("zero");
  });
});

describe("静止状態の電源短絡", () => {
  it("+24V と 0V を直結すれば ▶ を押さなくても分かる", () => {
    const document = circuit({ PS1: POWER }, [wire("PS1:plus", "PS1:zero")]);

    expect(codes(document)).toContain("power-short-circuit");
  });

  /**
   * B 接点は静止状態で閉じている。押していないから安全、ではない。
   */
  it("B 接点を挟んだだけの直結も静止状態で閉じている", () => {
    const document = circuit({ PS1: POWER, S1: PB_NC }, [
      wire("PS1:plus", "S1:1"),
      wire("S1:2", "PS1:zero"),
    ]);

    expect(codes(document)).toContain("power-short-circuit");
  });

  /**
   * ここが「静的チェック」の境界。押して初めて成立する短絡は出ない
   * —— 出ないことを保証しておかないと、指摘が無いことの意味がぶれる。
   */
  it("押して初めて閉じる A 接点の短絡は出さない（▶ の診断に任せる）", () => {
    const document = circuit({ PS1: POWER, S1: PB_NO }, [
      wire("PS1:plus", "S1:1"),
      wire("S1:2", "PS1:zero"),
    ]);

    expect(codes(document)).not.toContain("power-short-circuit");
  });

  it("負荷を挟んだ正しい回路では出ない", () => {
    const document = circuit({ PS1: POWER, L1: LAMP }, [
      wire("PS1:plus", "L1:1"),
      wire("L1:2", "PS1:zero"),
    ]);

    expect(codes(document)).not.toContain("power-short-circuit");
  });
});

describe("還流ダイオードの向き", () => {
  const base = { PS1: POWER, S1: PB_NO, RY1: MY4N, D1: DIODE };

  /** コイル（13 = − / 14 = +）と並列にダイオードを入れる */
  const withDiode = (anodeTo: string, cathodeTo: string) =>
    circuit(base, [
      wire("PS1:plus", "S1:1"),
      wire("S1:2", "RY1:14"),
      wire("RY1:13", "PS1:zero"),
      // 端子 ID は小文字（ラベルの "A" / "K" と別物）
      wire("D1:a", anodeTo),
      wire("D1:k", cathodeTo),
    ]);

  /**
   * 逆挿しは「通電したら短絡する」誤りなので、**接点が開いている静止状態でも**
   * 警告する。押してみるまで分からない、では配線前の確認にならない。
   */
  it("逆挿し（アノードがコイルの + 側）を静止状態で検出する", () => {
    const warnings = check(withDiode("RY1:14", "RY1:13"));
    const reversed = warnings.filter(
      (warning) => warning.code === "diode-reversed",
    );

    expect(reversed).toHaveLength(1);
    expect(reversed[0].severity).toBe("error");
    expect(reversed[0].componentId).toBe("D1");
  });

  it("正しい向き（カソードがコイルの + 側）では出ない", () => {
    expect(codes(withDiode("RY1:13", "RY1:14"))).not.toContain(
      "diode-reversed",
    );
  });
});

describe("収束にまつわる指摘は含めない", () => {
  /**
   * 発振（B 接点による自励）は反復を回して初めて分かる。
   * 静止状態の 1 パスしか見ないここには原理的に出ない。
   */
  it("自励発振する回路でも oscillating は出ない", () => {
    const document = circuit({ PS1: POWER, RY1: MY4N }, [
      // コイルを自分の B 接点（NC = 1、COM = 9）越しに繋ぐ
      wire("PS1:plus", "RY1:9"),
      wire("RY1:1", "RY1:14"),
      wire("RY1:13", "PS1:zero"),
    ]);

    const found = codes(document);
    expect(found).not.toContain("oscillating");
    expect(found).not.toContain("not-converged");
  });

  /**
   * 極性は「コイルに電位がかかって初めて」判定できるため、
   * 出方が安定しない。静的チェックからは外してある。
   */
  it("コイル極性の指摘は出さない", () => {
    const document = circuit(
      { PS1: POWER, RY1: "omron-my4n-d2-dc24" },
      [
        // 13（−）へ + を、14（+）へ 0V を繋いだ逆接
        wire("PS1:plus", "RY1:13"),
        wire("RY1:14", "PS1:zero"),
      ],
    );

    expect(codes(document)).not.toContain("coil-polarity-reversed");
  });
});
