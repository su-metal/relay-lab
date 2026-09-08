import { describe, expect, it } from "vitest";

import { componentRegistry, dimmingConsole } from "@/circuit/definitions";
import { inspectWiring, simulate } from "@/circuit/engine";
import type {
  CircuitConnection,
  CircuitDocument,
  ComponentDefinition,
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

describe("VP電源・スクリーン上昇/停止/下降のボタンが通信で送られる", () => {
  /**
   * 実機のコントローラは端子 33〜36 の**オープンコレクタ出力**でこれを
   * 受ける（`dimmingController16ch.electrical.digitalOutputs`・design.md
   * §5.22）。この describe は「コンソールのボタンが `communication.transmits`
   * に正しく載っていること」を、`analog-source` の電圧出力（`channels`）
   * だけを持つ最小の合成受信機で確かめる —— 実際に接点として閉じるかどうか
   * は下の「実機のコントローラで VP・スクリーンの出力が実際に閉じる」で見る。
   */
  const receiver: ComponentDefinition = {
    id: "test-vp-screen-receiver",
    model: "テスト用受信機",
    category: "dimmer",
    terminals: [
      {
        id: "OUT",
        label: "OUT",
        role: "analog_signal",
        position: { x: 1, y: 0.15 },
        side: "right",
      },
      {
        id: "OUT2",
        label: "OUT2",
        role: "analog_signal",
        position: { x: 1, y: 0.3 },
        side: "right",
      },
      {
        id: "COM",
        label: "COM",
        role: "analog_common",
        position: { x: 1, y: 0.5 },
        side: "right",
      },
      {
        id: "PLUS",
        label: "+",
        role: "generic",
        position: { x: 0, y: 0.3 },
        side: "left",
      },
      {
        id: "MINUS",
        label: "-",
        role: "generic",
        position: { x: 0, y: 0.6 },
        side: "left",
      },
      {
        id: "GND",
        label: "GND",
        role: "generic",
        position: { x: 0, y: 0.9 },
        side: "left",
      },
      // 未使用端子。OUT / OUT2 を自分自身へ配線して netOf に載せるためだけに使う
      {
        id: "NC",
        label: "NC",
        role: "generic",
        position: { x: 1, y: 0.7 },
        side: "right",
        optional: true,
      },
      {
        id: "NC2",
        label: "NC2",
        role: "generic",
        position: { x: 1, y: 0.85 },
        side: "right",
        optional: true,
      },
    ],
    electrical: {
      kind: "analog-source",
      channels: [
        { id: "vp", signalTerminal: "OUT", label: "VP電源" },
        { id: "screen", signalTerminal: "OUT2", label: "スクリーン上昇" },
      ],
      commonTerminals: ["COM"],
      // 通信で受けた % を V へ直す規則。操作していれば 100% → 0V
      outputCurve: { minVolts: 0, maxVolts: 10, percentAtMin: 100, percentAtMax: 0 },
      minVolts: 0,
      maxVolts: 10,
      defaultVolts: 10,
    },
    communication: {
      port: { plusTerminal: "PLUS", minusTerminal: "MINUS", commonTerminals: ["GND"] },
      receives: [
        { signalId: "vpPower", channelId: "vp" },
        { signalId: "screenUp", channelId: "screen" },
      ],
    },
    visual: { width: 160, height: 140 },
    source: "テスト用の合成定義",
    verified: false,
  };
  const registry = new Map(componentRegistry).set(receiver.id, receiver);

  const document: CircuitDocument = {
    version: 1,
    components: [
      { id: "CP", definitionId: dimmingConsole.id, label: "操作卓", position: { x: 0, y: 0 } },
      { id: "R1", definitionId: receiver.id, label: "R1", position: { x: 400, y: 0 } },
    ],
    connections: [
      wire("CP:7", "R1:PLUS"),
      wire("CP:8", "R1:MINUS"),
      wire("CP:9", "R1:GND"),
      // OUT / OUT2 を未使用端子(NC/NC2)へ配線し、netOf にネットを持たせる
      // （既存の `communication.test.ts` の `voltsAt` と同じ手法）
      wire("R1:OUT", "R1:NC"),
      wire("R1:OUT2", "R1:NC2"),
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };

  const voltsOfSignal = (
    result: SimulationResult,
    terminal: "OUT" | "OUT2" = "OUT",
  ): number | undefined => {
    const net = result.netOf.get(`R1:${terminal}`);
    return net === undefined ? undefined : result.analog.signalOf.get(net)?.volts;
  };

  it("操作していないときは既定値のまま（10V）", () => {
    const result = simulate(document, registry, {
      pressedSwitches: new Set(),
      operatedDevices: new Set(),
    });
    expect(voltsOfSignal(result)).toBe(10);
  });

  it("VP電源ボタンを倒すと通信で送られ、受け手の出力が変わる", () => {
    const result = simulate(document, registry, {
      pressedSwitches: new Set(),
      operatedDevices: new Set([operationKey("CP", "vpPower")]),
    });
    expect(voltsOfSignal(result, "OUT")).toBe(0);
  });

  it("スクリーン上昇ボタンを倒しても同じ経路で送られる", () => {
    const result = simulate(document, registry, {
      pressedSwitches: new Set(),
      operatedDevices: new Set([operationKey("CP", "screenUp")]),
    });
    expect(voltsOfSignal(result, "OUT2")).toBe(0);
  });

  it("スクリーン停止・下降ボタンも操作子として存在する", () => {
    const ids = new Set(
      dimmingConsole.electrical.kind === "relay"
        ? (dimmingConsole.electrical.relay.operations ?? []).map((op) => op.id)
        : [],
    );
    expect(ids.has("screenStop")).toBe(true);
    expect(ids.has("screenDown")).toBe(true);
    expect(dimmingConsole.communication?.transmits).toEqual(
      expect.arrayContaining(["vpPower", "screenUp", "screenStop", "screenDown"]),
    );
  });
});

describe("実機のコントローラで VP・スクリーンの出力が実際に閉じる（design.md §5.22）", () => {
  const document = panel(CORRECT);

  /** 端子 n が GND（21）と同じネットにいる＝オープンコレクタが閉じている */
  const closedToGnd = (result: SimulationResult, terminal: string): boolean =>
    result.netOf.get(`C1:${terminal}`) === result.netOf.get("C1:21");

  it("何も操作していなければ 33〜36 はどれも GND から浮いている", () => {
    const result = step(document);
    for (const terminal of ["33", "34", "35", "36"]) {
      expect(closedToGnd(result, terminal)).toBe(false);
    }
  });

  it("VP電源を倒すと端子 33 だけ GND へ落ちる", () => {
    const result = step(document, {}, [operationKey("CP", "vpPower")]);
    expect(closedToGnd(result, "33")).toBe(true);
    expect(closedToGnd(result, "34")).toBe(false);
    expect(closedToGnd(result, "35")).toBe(false);
    expect(closedToGnd(result, "36")).toBe(false);
  });

  it("スクリーン上昇を倒すと端子 34 だけ GND へ落ちる", () => {
    const result = step(document, {}, [operationKey("CP", "screenUp")]);
    expect(closedToGnd(result, "34")).toBe(true);
    expect(closedToGnd(result, "33")).toBe(false);
  });

  it("スクリーン停止を倒すと端子 35 だけ GND へ落ちる", () => {
    const result = step(document, {}, [operationKey("CP", "screenStop")]);
    expect(closedToGnd(result, "35")).toBe(true);
  });

  it("スクリーン下降を倒すと端子 36 だけ GND へ落ちる", () => {
    const result = step(document, {}, [operationKey("CP", "screenDown")]);
    expect(closedToGnd(result, "36")).toBe(true);
  });

  it("同時に倒せば複数の出力が同時に閉じる", () => {
    const result = step(document, {}, [
      operationKey("CP", "vpPower"),
      operationKey("CP", "screenUp"),
    ]);
    expect(closedToGnd(result, "33")).toBe(true);
    expect(closedToGnd(result, "34")).toBe(true);
    expect(closedToGnd(result, "35")).toBe(false);
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
