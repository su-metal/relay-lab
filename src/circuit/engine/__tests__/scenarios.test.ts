import { describe, expect, it } from "vitest";

import { componentRegistry } from "@/circuit/definitions";
import { simulate } from "@/circuit/engine";
import type {
  CircuitConnection,
  CircuitDocument,
  SimulationResult,
} from "@/circuit/types";

/**
 * requirements.md US-A の検証回路テスト 1〜5。
 *
 * UI を一切使わず、JSON で回路を組んで `simulate()` を呼ぶ。
 * 端子は実端子番号で指定する（MY4N のコイルは 13 / 14、第1接点は NC=1 / NO=5 / COM=9）。
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

/**
 * 回路を 1 手ぶん進める。
 * `previous` に前回の結果を渡すと励磁状態を引き継ぐ（自己保持の再現に必要）。
 */
const step = (
  document: CircuitDocument,
  pressed: string[],
  previous?: SimulationResult,
): SimulationResult =>
  simulate(document, componentRegistry, {
    pressedSwitches: new Set(pressed),
    previousEnergizedRelays: previous?.energizedRelays,
  });

const energized = (result: SimulationResult): string[] =>
  [...result.energizedRelays].sort();

const lit = (result: SimulationResult): string[] => [...result.litLamps].sort();

const POWER = "power-dc24v";
const PB_NO = "switch-pushbutton-no";
const PB_NC = "switch-pushbutton-nc";
const MY4N = "omron-my4n-dc24";
const LAMP = "lamp-dc24v";
const G7L_1A = "omron-g7l-1a-t-dc24";

describe("検証回路テスト1: +24V → S1(A接点) → RY1コイル → 0V", () => {
  const document = circuit(
    { PS1: POWER, S1: PB_NO, RY1: MY4N },
    [
      wire("PS1:plus", "S1:1"),
      wire("S1:2", "RY1:14"),
      wire("RY1:13", "PS1:zero"),
    ],
  );

  it("S1 を押していない間は RY1 が励磁しない", () => {
    const result = step(document, []);
    expect(result.status).toBe("stable");
    expect(energized(result)).toEqual([]);
  });

  it("S1 押下中のみ RY1 が励磁する", () => {
    const pressed = step(document, ["S1"]);
    expect(pressed.status).toBe("stable");
    expect(energized(pressed)).toEqual(["RY1"]);

    const released = step(document, [], pressed);
    expect(released.status).toBe("stable");
    expect(energized(released)).toEqual([]);
  });

  it("コイルの 2 端子は導通しない（負荷を union しない）", () => {
    const result = step(document, ["S1"]);
    expect(result.netOf.get("RY1:14")).not.toBe(result.netOf.get("RY1:13"));
    expect(
      result.warnings.filter((w) => w.code === "power-short-circuit"),
    ).toEqual([]);
  });
});

describe("検証回路テスト2: +24V → RY1のA接点 → L1 → 0V", () => {
  const document = circuit(
    { PS1: POWER, S1: PB_NO, RY1: MY4N, L1: LAMP },
    [
      // コイル回路
      wire("PS1:plus", "S1:1"),
      wire("S1:2", "RY1:14"),
      wire("RY1:13", "PS1:zero"),
      // 第1接点の a 接点（COM 9 → NO 5）でランプを点ける
      wire("PS1:plus", "RY1:9"),
      wire("RY1:5", "L1:1"),
      wire("L1:2", "PS1:zero"),
    ],
  );

  it("非励磁では COM が NC 側に繋がるので L1 は消灯", () => {
    const result = step(document, []);
    expect(result.status).toBe("stable");
    expect(lit(result)).toEqual([]);
    // COM 9 は NC 1 と導通し、NO 5 とは切れている
    expect(result.netOf.get("RY1:9")).toBe(result.netOf.get("RY1:1"));
    expect(result.netOf.get("RY1:9")).not.toBe(result.netOf.get("RY1:5"));
  });

  it("RY1 励磁時に接点が切り替わり L1 が点灯する", () => {
    const result = step(document, ["S1"]);
    expect(result.status).toBe("stable");
    expect(energized(result)).toEqual(["RY1"]);
    expect(lit(result)).toEqual(["L1"]);
    expect(result.netOf.get("RY1:9")).toBe(result.netOf.get("RY1:5"));
  });

  it("MY4N が励磁すると 4 回路すべての接点が同時に切り替わる", () => {
    const result = step(document, ["S1"]);
    for (const [com, no, nc] of [
      ["9", "5", "1"],
      ["10", "6", "2"],
      ["11", "7", "3"],
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
});

describe("検証回路テスト3: 自己保持（S1 と RY1 の A 接点を並列）", () => {
  const document = circuit(
    { PS1: POWER, S1: PB_NO, RY1: MY4N },
    [
      wire("PS1:plus", "S1:1"),
      wire("S1:2", "RY1:14"),
      // 自己保持接点。COM 9 に +24V、NO 5 をコイル 14 へ戻す
      wire("PS1:plus", "RY1:9"),
      wire("RY1:5", "RY1:14"),
      wire("RY1:13", "PS1:zero"),
    ],
  );

  it("S1 を一瞬押しただけで RY1 が励磁し続ける", () => {
    const idle = step(document, []);
    expect(energized(idle)).toEqual([]);

    const pressed = step(document, ["S1"], idle);
    expect(pressed.status).toBe("stable");
    expect(energized(pressed)).toEqual(["RY1"]);

    // ボタンを離しても自己保持接点で励磁が続く
    const released = step(document, [], pressed);
    expect(released.status).toBe("stable");
    expect(energized(released)).toEqual(["RY1"]);

    // さらに時間が経っても保持されたまま
    const later = step(document, [], released);
    expect(later.status).toBe("stable");
    expect(energized(later)).toEqual(["RY1"]);
  });
});

describe("検証回路テスト4: 停止付き自己保持（S2 の B 接点を直列に追加）", () => {
  const document = circuit(
    { PS1: POWER, S1: PB_NO, S2: PB_NC, RY1: MY4N },
    [
      // +24V → S2(B接点) → 起動系統
      wire("PS1:plus", "S2:1"),
      wire("S2:2", "S1:1"),
      wire("S2:2", "RY1:9"),
      wire("S1:2", "RY1:14"),
      wire("RY1:5", "RY1:14"),
      wire("RY1:13", "PS1:zero"),
    ],
  );

  it("S1 で自己保持し、S2 押下で消磁する", () => {
    const idle = step(document, []);
    expect(energized(idle)).toEqual([]);

    const started = step(document, ["S1"], idle);
    expect(started.status).toBe("stable");
    expect(energized(started)).toEqual(["RY1"]);

    const holding = step(document, [], started);
    expect(energized(holding)).toEqual(["RY1"]);

    // 停止ボタンは B 接点なので、押すと回路が切れる
    const stopping = step(document, ["S2"], holding);
    expect(stopping.status).toBe("stable");
    expect(energized(stopping)).toEqual([]);

    // 離しても再励磁しない
    const stopped = step(document, [], stopping);
    expect(stopped.status).toBe("stable");
    expect(energized(stopped)).toEqual([]);
  });
});

describe("検証回路テスト5: インターロック（RY1・RY2 の B 接点を相互に直列）", () => {
  const document = circuit(
    { PS1: POWER, S1: PB_NO, S2: PB_NO, RY1: MY4N, RY2: MY4N },
    [
      // RY1 系統: +24V → S1 → RY2 の b 接点(COM 9 → NC 1) → RY1 コイル
      wire("PS1:plus", "S1:1"),
      wire("S1:2", "RY2:9"),
      wire("RY2:1", "RY1:14"),
      wire("RY1:13", "PS1:zero"),
      // RY2 系統: +24V → S2 → RY1 の b 接点(COM 9 → NC 1) → RY2 コイル
      wire("PS1:plus", "S2:1"),
      wire("S2:2", "RY1:9"),
      wire("RY1:1", "RY2:14"),
      wire("RY2:13", "PS1:zero"),
    ],
  );

  it("先に励磁した側が優先され、もう片方は励磁しない", () => {
    const idle = step(document, []);
    expect(energized(idle)).toEqual([]);

    const first = step(document, ["S1"], idle);
    expect(first.status).toBe("stable");
    expect(energized(first)).toEqual(["RY1"]);

    // RY1 が励磁中は、S2 を押しても RY2 は励磁しない
    const both = step(document, ["S1", "S2"], first);
    expect(both.status).toBe("stable");
    expect(energized(both)).toEqual(["RY1"]);
  });

  it("逆順でも同じく片方だけが励磁する", () => {
    const first = step(document, ["S2"]);
    expect(first.status).toBe("stable");
    expect(energized(first)).toEqual(["RY2"]);

    const both = step(document, ["S1", "S2"], first);
    expect(both.status).toBe("stable");
    expect(energized(both)).toEqual(["RY2"]);
  });

  it("全て離すと両方とも消磁する", () => {
    const first = step(document, ["S1"]);
    const released = step(document, [], first);
    expect(released.status).toBe("stable");
    expect(energized(released)).toEqual([]);
  });
});

describe("発振の検出（design.md §5.5）", () => {
  // 自分の b 接点をコイルに直列に入れたブザー回路。
  // 励磁 → 接点が開く → 消磁 → 接点が閉じる、を繰り返す
  const document = circuit(
    { PS1: POWER, RY1: MY4N },
    [
      wire("PS1:plus", "RY1:9"),
      wire("RY1:1", "RY1:14"),
      wire("RY1:13", "PS1:zero"),
    ],
  );

  it("反復上限ではなく oscillating として区別される", () => {
    const result = step(document, []);
    expect(result.status).toBe("oscillating");
    expect(result.iterations).toBeLessThan(10);
    expect(result.warnings.map((w) => w.code)).toContain("oscillating");
    // 配線として正しい回路なので、エラーではなく info で提示する
    expect(
      result.warnings.find((w) => w.code === "oscillating")?.severity,
    ).toBe("info");
  });
});

describe("警告の検出（design.md §5.7）", () => {
  it("+24V と 0V を直結すると電源短絡を検出する", () => {
    const document = circuit({ PS1: POWER }, [wire("PS1:plus", "PS1:zero")]);
    const result = step(document, []);
    const short = result.warnings.find(
      (w) => w.code === "power-short-circuit",
    );
    expect(short?.severity).toBe("error");
    expect(short?.componentId).toBe("PS1");
  });

  it("MY4N は無極性なので、コイルを逆に繋いでも励磁し警告も出ない", () => {
    const document = circuit(
      { PS1: POWER, RY1: MY4N },
      [wire("PS1:plus", "RY1:13"), wire("RY1:14", "PS1:zero")],
    );
    const result = step(document, []);
    // polarity: "none"。表示灯が逆並列 LED で逆接でも点くため、
    // 逆接は「正常な使い方」であって警告に値しない（design.md §4.4 / §5.3）
    expect(energized(result)).toEqual(["RY1"]);
    expect(
      result.warnings.filter((w) => w.code === "coil-polarity-reversed"),
    ).toEqual([]);
  });

  it("未接続の端子を info として報告する", () => {
    const document = circuit(
      { PS1: POWER, RY1: MY4N },
      [wire("PS1:plus", "RY1:14"), wire("RY1:13", "PS1:zero")],
    );
    const result = step(document, []);
    const unconnected = result.warnings.filter(
      (w) => w.code === "unconnected-terminal",
    );
    // MY4N の接点 12 端子がすべて未接続
    expect(unconnected).toHaveLength(12);
    expect(unconnected.every((w) => w.severity === "info")).toBe(true);
  });

  it("正しく組んだ回路では error / warning が出ない", () => {
    const document = circuit(
      { PS1: POWER, S1: PB_NO, RY1: MY4N },
      [
        wire("PS1:plus", "S1:1"),
        wire("S1:2", "RY1:14"),
        wire("RY1:13", "PS1:zero"),
      ],
    );
    const result = step(document, ["S1"]);
    expect(result.warnings.filter((w) => w.severity !== "info")).toEqual([]);
  });
});

describe("ネット状態（design.md §5.6 の入力）", () => {
  const document = circuit(
    { PS1: POWER, S1: PB_NO, RY1: MY4N },
    [
      wire("PS1:plus", "S1:1"),
      wire("S1:2", "RY1:14"),
      wire("RY1:13", "PS1:zero"),
    ],
  );

  const stateOf = (result: SimulationResult, key: string) =>
    result.netState.get(result.netOf.get(key) as number);

  it("押下中は + 側ネットと 0V 側ネットが区別できる", () => {
    const result = step(document, ["S1"]);
    expect(stateOf(result, "RY1:14")).toEqual({
      reachesPlus: true,
      reachesZero: false,
    });
    expect(stateOf(result, "RY1:13")).toEqual({
      reachesPlus: false,
      reachesZero: true,
    });
  });

  it("開いているスイッチの先は非通電（グレー）になる", () => {
    const result = step(document, []);
    expect(stateOf(result, "RY1:14")).toEqual({
      reachesPlus: false,
      reachesZero: false,
    });
  });
});

/**
 * G7L は a接点のみ（SPST-NO・NC 無し）で、MY4N の SPDT とは接点トポロジが
 * 異なる（design.md §4.8・§5.1）。`closedContactPairs()` が「NC が無い接点は
 * 非励磁時に何も union しない（開いたまま）」を正しく処理できることを、
 * `simulate()` を通して確認する。
 */
describe("G7L-1A-T（a接点のみ）: +24V → S1(A接点) → RY1コイル → 0V、L1 は RY1 の a接点で点灯", () => {
  const document = circuit(
    { PS1: POWER, S1: PB_NO, RY1: G7L_1A, L1: LAMP },
    [
      wire("PS1:plus", "S1:1"),
      wire("S1:2", "RY1:1"),
      wire("RY1:0", "PS1:zero"),
      wire("PS1:plus", "RY1:4"),
      wire("RY1:6", "L1:1"),
      wire("L1:2", "PS1:zero"),
    ],
  );

  it("非励磁では COM(4) と NO(6) が別ネット（開いたまま）で、L1 は点かない", () => {
    const result = step(document, []);
    expect(energized(result)).toEqual([]);
    expect(lit(result)).toEqual([]);
    expect(result.netOf.get("RY1:4")).not.toBe(result.netOf.get("RY1:6"));
  });

  it("励磁すると COM(4)–NO(6) が同一ネットになり L1 が点く", () => {
    const result = step(document, ["S1"]);
    expect(energized(result)).toEqual(["RY1"]);
    expect(lit(result)).toEqual(["L1"]);
    expect(result.netOf.get("RY1:4")).toBe(result.netOf.get("RY1:6"));
  });
});
