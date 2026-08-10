/**
 * 負荷 1 個の経路説明の検証（design.md §5.11）。
 *
 * 守りたいのは 4 つ。
 *
 * 1. **経路が実端子番号で読める。** "+24V → 起動ボタン 1→2 → コイル 14" のように、
 *    通る順に部品と端子が並ぶこと
 * 2. **止まっている理由が「どちら側が届いていないか」まで言える。** 非励磁を
 *    「非励磁です」で終わらせない
 * 3. **手前で開いている接点を 1 枚に絞れる。** 開いた接点を全部並べるのではなく、
 *    **閉じれば実際に電源へ届く**ものだけを挙げること
 * 4. **停止中は何も言わない。** 消磁しているのか動いていないのかを取り違えさせない
 */

import { describe, expect, it } from "vitest";

import { explainLoadPath, trimLoadEnds } from "@/circuit/adapter/load-path";
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
const PB_NC = "switch-pushbutton-nc";
const MY4N = "omron-my4n-dc24";
const LAMP = "lamp-dc24v";

const explain = (
  doc: CircuitDocument,
  componentId: string,
  pressed: string[] = [],
) => {
  const pressedSwitches = new Set(pressed);
  const result = simulate(doc, componentRegistry, { pressedSwitches });
  return explainLoadPath(
    doc,
    componentRegistry,
    result,
    pressedSwitches,
    componentId,
  );
};

/** 経路を "部品(端子→端子)" の並びに畳んで比べやすくする */
const traceOf = (
  steps: { label: string; terminalLabels: string[] }[] | undefined,
): string[] =>
  (steps ?? []).map(
    (step) => `${step.label}(${step.terminalLabels.join("→")})`,
  );

/** +24V → 起動ボタン → コイル 14 / コイル 13 → 0V */
const straight = circuit({ PS1: POWER, S1: PB_NO, RY1: MY4N }, [
  wire("PS1:plus", "S1:1"),
  wire("S1:2", "RY1:14"),
  wire("RY1:13", "PS1:zero"),
]);

describe("explainLoadPath — 通電中の経路", () => {
  it("停止中（result が null）は何も返さない", () => {
    expect(
      explainLoadPath(straight, componentRegistry, null, new Set(), "RY1"),
    ).toBeNull();
  });

  it("リレー・ランプ以外は対象外", () => {
    expect(explain(straight, "S1")).toBeNull();
    expect(explain(straight, "PS1")).toBeNull();
  });

  it("励磁している経路を実端子番号で並べる", () => {
    const explanation = explain(straight, "RY1", ["S1"]);

    expect(explanation?.active).toBe(true);
    expect(explanation?.inletLabel).toBe("14");
    expect(explanation?.outletLabel).toBe("13");
    expect(traceOf(explanation?.supplyRun?.steps)).toEqual([
      "PS1(+24V)",
      "S1(1→2)",
      "RY1(14)",
    ]);
    expect(traceOf(explanation?.returnRun?.steps)).toEqual([
      "RY1(13)",
      "PS1(0V)",
    ]);
    expect(explanation?.supplyRun?.branched).toBe(false);
  });

  it("自己保持している経路には、自分の接点が経路として現れる", () => {
    /*
     * 起動ボタンを離した後の保持経路。コイル 14 を支えているのは
     * 自分の第1接点（COM 9 → NO 5）であり、それが経路に出ることが
     * 「今このリレーを保持しているのは自分自身」の説明になる。
     */
    const selfHold = circuit({ PS1: POWER, S1: PB_NO, S2: PB_NC, RY1: MY4N }, [
      wire("PS1:plus", "S2:1"),
      wire("S2:2", "S1:1"),
      wire("S2:2", "RY1:9"),
      wire("S1:2", "RY1:14"),
      wire("RY1:5", "RY1:14"),
      wire("RY1:13", "PS1:zero"),
    ]);

    const pressedSwitches = new Set<string>();
    const idle = simulate(selfHold, componentRegistry, { pressedSwitches });
    const pushed = simulate(selfHold, componentRegistry, {
      pressedSwitches: new Set(["S1"]),
      previousEnergizedRelays: idle.energizedRelays,
    });
    const held = simulate(selfHold, componentRegistry, {
      pressedSwitches,
      previousEnergizedRelays: pushed.energizedRelays,
    });
    const explanation = explainLoadPath(
      selfHold,
      componentRegistry,
      held,
      pressedSwitches,
      "RY1",
    );

    expect(explanation?.active).toBe(true);
    expect(traceOf(explanation?.supplyRun?.steps)).toEqual([
      "PS1(+24V)",
      "S2(1→2)",
      "RY1(9→5→14)",
    ]);
  });

  it("接点の先のランプも、接点を通る経路として説明できる", () => {
    const withLamp = circuit(
      { PS1: POWER, S1: PB_NO, RY1: MY4N, L1: LAMP },
      [
        wire("PS1:plus", "S1:1"),
        wire("S1:2", "RY1:14"),
        wire("RY1:13", "PS1:zero"),
        wire("PS1:plus", "RY1:9"),
        wire("RY1:5", "L1:1"),
        wire("L1:2", "PS1:zero"),
      ],
    );
    const explanation = explain(withLamp, "L1", ["S1"]);

    expect(explanation?.kind).toBe("lamp");
    expect(traceOf(explanation?.supplyRun?.steps)).toEqual([
      "PS1(+24V)",
      "RY1(9→5)",
      "L1(1)",
    ]);
  });

  it("並列に分かれている区間は branched で申告する", () => {
    const parallel = circuit(
      { PS1: POWER, TB1: "terminal-block-6p", RY1: MY4N },
      [
        wire("PS1:plus", "TB1:1"),
        wire("TB1:4", "RY1:14"),
        wire("PS1:plus", "RY1:14"),
        wire("RY1:13", "PS1:zero"),
      ],
    );
    const explanation = explain(parallel, "RY1");

    expect(explanation?.active).toBe(true);
    expect(explanation?.supplyRun?.branched).toBe(true);
    // 帰り道は 1 本しかないので絞れる
    expect(explanation?.returnRun?.branched).toBe(false);
  });
});

describe("trimLoadEnds — 表示用に負荷の端子を端から外す", () => {
  it("負荷だけの区間は丸ごと消える", () => {
    const explanation = explain(straight, "RY1", ["S1"]);
    const { supply, back } = trimLoadEnds(explanation!);

    // "RY1(14)" と "RY1(13)" は負荷の見出し行が受け持つので経路から外れる
    expect(traceOf(supply)).toEqual(["PS1(+24V)", "S1(1→2)"]);
    expect(traceOf(back)).toEqual(["PS1(0V)"]);
  });

  it("自己保持接点は残る（端の 1 個しか外さない）", () => {
    /*
     * ここが潰れると「何がこのコイルを保持しているのか」が画面から消える。
     * 外すのはコイル端子 14 だけで、通ってきた接点 9 → 5 は経路に残す。
     */
    const selfHold = circuit({ PS1: POWER, S1: PB_NO, S2: PB_NC, RY1: MY4N }, [
      wire("PS1:plus", "S2:1"),
      wire("S2:2", "S1:1"),
      wire("S2:2", "RY1:9"),
      wire("S1:2", "RY1:14"),
      wire("RY1:5", "RY1:14"),
      wire("RY1:13", "PS1:zero"),
    ]);
    const pushed = simulate(selfHold, componentRegistry, {
      pressedSwitches: new Set(["S1"]),
    });
    const held = simulate(selfHold, componentRegistry, {
      pressedSwitches: new Set(),
      previousEnergizedRelays: pushed.energizedRelays,
    });
    const explanation = explainLoadPath(
      selfHold,
      componentRegistry,
      held,
      new Set(),
      "RY1",
    );

    expect(traceOf(trimLoadEnds(explanation!).supply)).toEqual([
      "PS1(+24V)",
      "S2(1→2)",
      "RY1(9→5)",
    ]);
  });

  it("非通電の説明を渡しても壊れない（経路が無いので空）", () => {
    const explanation = explain(straight, "RY1");
    expect(trimLoadEnds(explanation!)).toEqual({ supply: [], back: [] });
  });
});

describe("explainLoadPath — 励磁しない理由", () => {
  it("ボタンを押していないときは「+ 側が届いていない」と言える", () => {
    const explanation = explain(straight, "RY1");

    expect(explanation?.active).toBe(false);
    const [plusSide, zeroSide] = explanation?.reach ?? [];
    expect(plusSide).toMatchObject({
      label: "14",
      expects: "plus",
      reachesPlus: false,
    });
    // 0V 側はちゃんと届いている。届いていない側だけを直せばよいと分かる
    expect(zeroSide).toMatchObject({
      label: "13",
      expects: "zero",
      reachesZero: true,
    });
  });

  it("手前で開いている接点を、閉じる条件つきで挙げる", () => {
    const explanation = explain(straight, "RY1");

    expect(explanation?.gates).toEqual([
      {
        componentId: "S1",
        label: "S1",
        terminalLabels: ["1", "2"],
        condition: "S1 を押すと閉じます",
        supply: "plus",
      },
    ]);
  });

  it("閉じても電源に届かない接点は挙げない", () => {
    /*
     * S1（起動ボタン）を閉じれば +24V に届くが、RY1 の第2接点（10–6）は
     * どこにも繋がっていないので閉じても何も変わらない。
     * 「開いている接点」を全部並べる実装だとここで増える。
     */
    const explanation = explain(straight, "RY1");
    expect(explanation?.gates?.map((gate) => gate.componentId)).toEqual(["S1"]);
  });

  it("インターロックで開いた b 接点を、相手のリレー名つきで挙げる", () => {
    /*
     * RY1 が励磁している間、その b 接点（9–1）が開いて RY2 が励磁できない。
     * 初心者が最も詰まる「正しく配線したのに動かない」の典型。
     */
    const interlock = circuit(
      { PS1: POWER, S1: PB_NO, RY1: MY4N, RY2: MY4N },
      [
        // RY1 は起動ボタンで励磁
        wire("PS1:plus", "S1:1"),
        wire("S1:2", "RY1:14"),
        wire("RY1:13", "PS1:zero"),
        // RY2 は RY1 の b 接点（COM 9 → NC 1）を通ってしか励磁できない
        wire("PS1:plus", "RY1:9"),
        wire("RY1:1", "RY2:14"),
        wire("RY2:13", "PS1:zero"),
      ],
    );

    const idle = explain(interlock, "RY2");
    // RY1 が非励磁なら b 接点は閉じているので RY2 も励磁している
    expect(idle?.active).toBe(true);

    const blocked = explain(interlock, "RY2", ["S1"]);
    expect(blocked?.active).toBe(false);
    expect(blocked?.gates).toEqual([
      {
        componentId: "RY1",
        label: "RY1",
        terminalLabels: ["9", "1"],
        condition: "RY1 が非励磁に戻ると閉じます",
        supply: "plus",
      },
    ]);
  });

  it("どこにも配線していない負荷は、両側とも届いていないと言う", () => {
    const floating = circuit({ PS1: POWER, RY1: MY4N }, []);
    const explanation = explain(floating, "RY1");

    expect(explanation?.active).toBe(false);
    expect(explanation?.reach?.[0]).toMatchObject({
      reachesPlus: false,
      reachesZero: false,
    });
    expect(explanation?.reach?.[1]).toMatchObject({
      reachesPlus: false,
      reachesZero: false,
    });
    // 閉じれば届く接点は存在しない。空で返り、UI は「配線してください」に倒せる
    expect(explanation?.gates).toEqual([]);
  });

  it("極性なしのコイルを逆接した回路では、届いている向きを尊重する", () => {
    /*
     * 13 番へ +24V、14 番を 0V 側へ繋いだ回路（MY4N は逆接でも励磁する）。
     * 定義上の + 端子（14）が + を待っていると決め打つと、
     * 「14 に + が来ていません」という的外れな指摘になる。
     */
    const reversed = circuit({ PS1: POWER, S1: PB_NO, RY1: MY4N }, [
      wire("PS1:plus", "RY1:13"),
      wire("RY1:14", "S1:1"),
      wire("S1:2", "PS1:zero"),
    ]);
    const explanation = explain(reversed, "RY1");

    expect(explanation?.active).toBe(false);
    expect(explanation?.reach?.[0]).toMatchObject({
      label: "14",
      expects: "zero",
    });
    expect(explanation?.reach?.[1]).toMatchObject({
      label: "13",
      expects: "plus",
      reachesPlus: true,
    });
    expect(explanation?.gates?.[0]).toMatchObject({
      componentId: "S1",
      supply: "zero",
    });
  });
});
