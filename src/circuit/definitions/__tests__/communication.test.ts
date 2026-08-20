import { describe, expect, it } from "vitest";

import { componentRegistry } from "@/circuit/definitions";
import { inspectWiring, simulate } from "@/circuit/engine";
import type {
  CircuitConnection,
  CircuitDocument,
  SimulationResult,
} from "@/circuit/types";
import { operationKey } from "@/circuit/types";

/**
 * 操作卓の通信でコントローラの出力が動くことの検証（design.md §4.17・§5.19）。
 *
 * 押さえたいのは 4 点。
 *
 * 1. **フェーダーを動かすと出力の電圧が変わる。** 盤の一番見たい動き
 * 2. **配線の不備で通信が成立しない。** 片側だけ・逆結線・GND 未共通
 * 3. **不備は ▶ を押す前に出る。** 動かしてみて初めて気付くのでは遅い
 * 4. **通信を使わない回路が変わらない。** 手動設定のまま今までどおり動く
 */

const wire = (from: string, to: string): CircuitConnection => {
  const [fc, ft] = from.split(":");
  const [tc, tt] = to.split(":");
  return {
    id: `${from}-${to}`,
    from: { componentId: fc, terminalId: ft },
    to: { componentId: tc, terminalId: tt },
  };
};

const CONSOLE = "dimming-console";
const CONTROLLER = "dimming-controller-16ch";

/** 操作卓 ↔ コントローラ。`links` で通信線の繋ぎ方を差し替える */
const panel = (links: CircuitConnection[]): CircuitDocument => ({
  version: 1,
  components: [
    { id: "CP", definitionId: CONSOLE, label: "操作卓", position: { x: 0, y: 0 } },
    { id: "C1", definitionId: CONTROLLER, label: "C1", position: { x: 400, y: 0 } },
  ],
  connections: links,
  viewport: { x: 0, y: 0, zoom: 1 },
});

/** 正しい繋ぎ方：＋どうし・−どうし・GND どうし */
const CORRECT = [
  wire("CP:7", "C1:22"),
  wire("CP:8", "C1:23"),
  wire("CP:9", "C1:21"),
];

const step = (
  document: CircuitDocument,
  levels: Record<string, number> = {},
  operated: string[] = [],
): SimulationResult =>
  simulate(document, componentRegistry, {
    pressedSwitches: new Set(),
    operatedDevices: new Set(operated),
    deviceLevels: new Map(
      Object.entries(levels).map(([id, percent]) => [
        operationKey("CP", id),
        percent,
      ]),
    ),
  });

/** コントローラの端子 n が出している電圧 */
const voltsAt = (result: SimulationResult, terminal: string): number | undefined => {
  const net = result.netOf.get(`C1:${terminal}`);
  return net === undefined ? undefined : result.analog.signalOf.get(net)?.volts;
};

describe("US-AU フェーダーで出力が変わる", () => {
  // 端子 1 と 2 を引き出して電圧を読む（信号ネットを作るため）
  const document = panel([
    ...CORRECT,
    wire("C1:1", "C1:17"),
    wire("C1:2", "C1:18"),
  ]);

  it("フェーダー 0% で消灯側（10V）、100% で全灯側（0V）", () => {
    expect(voltsAt(step(document, { fader1: 0 }), "1")).toBe(10);
    expect(voltsAt(step(document, { fader1: 100 }), "1")).toBe(0);
  });

  it("中間の位置では中間の電圧になる", () => {
    expect(voltsAt(step(document, { fader1: 70 }), "1")).toBeCloseTo(3, 5);
  });

  it("フェーダーが独立して効く", () => {
    const r = step(document, { fader1: 100, fader2: 0 });
    expect(voltsAt(r, "1")).toBe(0);
    expect(voltsAt(r, "2")).toBe(10);
  });

  /** 操作していないフェーダーは既定 0%（＝消灯側）。置いた瞬間に全灯しない */
  it("操作していないフェーダーは消灯側のまま", () => {
    expect(voltsAt(step(document), "1")).toBe(10);
  });
});

describe("US-AV 照明スイッチが入り切りで効く", () => {
  const document = panel([...CORRECT, wire("C1:9", "C1:17")]);

  it("倒すと全灯側、倒さないと消灯側", () => {
    expect(voltsAt(step(document), "9")).toBe(10);
    expect(voltsAt(step(document, {}, [operationKey("CP", "light1")]), "9")).toBe(0);
  });
});

describe("US-AW 通信線の配線ミスが分かる", () => {
  const codesOf = (document: CircuitDocument) =>
    step(document).warnings.filter((w) => w.code === "communication-wiring");

  it("＋しか繋いでいないと指摘される", () => {
    const half = panel([wire("CP:7", "C1:22"), wire("CP:9", "C1:21")]);
    expect(codesOf(half).length).toBeGreaterThan(0);
    expect(codesOf(half)[0].message).toMatch(/片側/);
  });

  it("＋と − が逆だと指摘される", () => {
    const reversed = panel([
      wire("CP:7", "C1:23"),
      wire("CP:8", "C1:22"),
      wire("CP:9", "C1:21"),
    ]);
    expect(codesOf(reversed).some((w) => /逆/.test(w.message))).toBe(true);
  });

  it("GND を共通にしていないと指摘される", () => {
    const noCommon = panel([wire("CP:7", "C1:22"), wire("CP:8", "C1:23")]);
    expect(codesOf(noCommon).some((w) => /基準/.test(w.message))).toBe(true);
  });

  /** 不備があるあいだは通信が成立せず、出力は手動設定のまま（既定 10V） */
  it("不備があると通信は成立しない", () => {
    const reversed = panel([
      wire("CP:7", "C1:23"),
      wire("CP:8", "C1:22"),
      wire("CP:9", "C1:21"),
      wire("C1:1", "C1:17"),
    ]);
    expect(voltsAt(step(reversed, { fader1: 100 }), "1")).toBe(10);
  });

  /** **▶ を押す前に出る。** 動かしてから気付くのでは原因を探すのに時間がかかる */
  it("停止中の配線チェックにも出る", () => {
    const noCommon = panel([wire("CP:7", "C1:22"), wire("CP:8", "C1:23")]);
    const warnings = inspectWiring(noCommon, componentRegistry);
    expect(warnings.some((w) => w.code === "communication-wiring")).toBe(true);
  });

  it("正しく繋げば警告は出ない", () => {
    expect(codesOf(panel(CORRECT))).toEqual([]);
  });

  /**
   * `commonTerminals` は複数本ある GND のうち**どれに繋いでも**成立する
   * はずの端子群（操作卓は 9・12、コントローラは 21・44・45・46）。
   * 配列の先頭（9・21）以外の組み合わせで繋いでも同じ結果になることを確認する
   * —— 未配線の端子も `netOf` 上はネットを持つため、「配線されているか」を
   * 見ずに「ネットがあるか」で判定すると、常に先頭の端子だけが採用され、
   * 他の GND 端子へ繋いでも一生警告が消えないバグが起きる。
   */
  it("GND は先頭以外の組み合わせ（12 と 44）で繋いでも成立する", () => {
    const document = panel([
      wire("CP:7", "C1:22"),
      wire("CP:8", "C1:23"),
      wire("CP:12", "C1:44"),
      wire("C1:1", "C1:17"),
    ]);
    expect(codesOf(document)).toEqual([]);
    expect(voltsAt(step(document, { fader1: 100 }), "1")).toBe(0);
  });
});

describe("US-AX 通信を使わない回路が壊れない", () => {
  /** 操作卓を置かない回路は、今までどおり手動設定で動く */
  it("操作卓が無ければ channelVolts のまま", () => {
    const manual: CircuitDocument = {
      version: 1,
      components: [
        {
          id: "C1",
          definitionId: CONTROLLER,
          label: "C1",
          position: { x: 0, y: 0 },
          channelVolts: { "1": 4 },
        },
      ],
      connections: [wire("C1:1", "C1:17")],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    const r = simulate(manual, componentRegistry, { pressedSwitches: new Set() });
    expect(voltsAt(r, "1")).toBe(4);
    expect(r.warnings.filter((w) => w.code === "communication-wiring")).toEqual([]);
  });
});
