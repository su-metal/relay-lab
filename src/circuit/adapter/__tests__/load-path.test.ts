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
const SELECTOR = "switch-selector-no";
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

/**
 * 先行優先回路（実際に使われている回路から）。
 *
 * b 接点のチェーンで「まだどのリレーも動いていない間だけ通る」起動経路を作り、
 * 上がったリレーは**チェーンより上流**から取った自分の a 接点で保持する。
 * この形では **起動に使ったセレクタが、起動した瞬間に回路から切り離される。**
 */
const priority = circuit(
  { PS1: POWER, SR: SELECTOR, RY1: MY4N, S1: SELECTOR, L1: LAMP },
  [
    wire("PS1:plus", "SR:1"),
    wire("SR:2", "RY1:9"),
    // 起動経路: b 接点 9–1 を抜けてセレクタへ、戻って b 接点 10–2 からコイルへ
    wire("RY1:1", "S1:1"),
    wire("S1:2", "RY1:10"),
    wire("RY1:2", "RY1:14"),
    // 保持経路: a 接点 9–5。チェーンより上流（SR の直後）から取る
    wire("RY1:5", "RY1:14"),
    wire("RY1:13", "PS1:zero"),
    wire("L1:1", "RY1:14"),
    wire("L1:2", "PS1:zero"),
  ],
);

/** SR と S1 を ON にして、自己保持が成立した状態まで進める */
const latched = () => {
  const pressedSwitches = new Set(["SR", "S1"]);
  const idle = simulate(priority, componentRegistry, {
    pressedSwitches: new Set(["SR"]),
  });
  const result = simulate(priority, componentRegistry, {
    pressedSwitches,
    previousEnergizedRelays: idle.energizedRelays,
  });
  return {
    result,
    explanation: explainLoadPath(
      priority,
      componentRegistry,
      result,
      pressedSwitches,
      "RY1",
    ),
  };
};

describe("起動経路（切れたきっかけの経路）", () => {
  it("保持経路には起動に使ったスイッチが出てこない", () => {
    const { result, explanation } = latched();

    expect([...result.energizedRelays]).toEqual(["RY1"]);
    // 9 → 5 は自分の a 接点、5 → 14 はそこからコイルへ戻す電線
    expect(traceOf(explanation?.supplyRun?.steps)).toEqual([
      "PS1(+24V)",
      "SR(1→2)",
      "RY1(9→5→14)",
    ]);
  });

  it("起動経路には出てくる（S1 を通ってコイルへ入った道）", () => {
    const { explanation } = latched();

    expect(traceOf(explanation?.startPath?.supply.steps)).toEqual([
      "PS1(+24V)",
      "SR(1→2)",
      "RY1(9→1)",
      "S1(1→2)",
      "RY1(10→2→14)",
    ]);
  });

  it("どの接点が開いてその経路が切れたのかを言える", () => {
    const { explanation } = latched();

    expect(
      explanation?.startPath?.breaks.map(
        (broken) => `${broken.label} ${broken.terminalLabels.join("-")}`,
      ),
    ).toEqual(["RY1 9-1", "RY1 10-2"]);
  });

  it("起動経路が今も生きているなら出さない（同じ道を 2 度並べない）", () => {
    /*
     * 押している間だけ励磁する回路。保持しているのはボタンなので、
     * 起動経路と今の経路が同じ。切れた接点も無い
     */
    const held = simulate(straight, componentRegistry, {
      pressedSwitches: new Set(["S1"]),
    });
    const explanation = explainLoadPath(
      straight,
      componentRegistry,
      held,
      new Set(["S1"]),
      "RY1",
    );

    expect(explanation?.active).toBe(true);
    expect(explanation?.startPath).toBeUndefined();
  });

  it("ランプには起動経路を出さない（接点を持たないので定義できない）", () => {
    const { explanation } = latched();
    const lamp = explainLoadPath(
      priority,
      componentRegistry,
      explanation ? latched().result : null,
      new Set(["SR", "S1"]),
      "L1",
    );

    expect(lamp?.active).toBe(true);
    expect(lamp?.startPath).toBeUndefined();
  });
});

describe("落とし方", () => {
  it("起動に使ったスイッチを戻しても落ちないことを言う", () => {
    const { explanation } = latched();
    const byId = new Map(
      (explanation?.releases ?? []).map((entry) => [entry.componentId, entry]),
    );

    // 保持は SR から直接取っているので、SR を戻せば落ちる
    expect(byId.get("SR")).toMatchObject({
      action: "OFF にする",
      releases: true,
      operated: true,
    });
    // **ここが誤解の芯。** 起動したのは S1 だが、S1 では落ちない
    expect(byId.get("S1")).toMatchObject({
      action: "OFF にする",
      releases: false,
      operated: true,
    });
  });

  it("触っていないスイッチは、落とせるものだけを挙げる", () => {
    /*
     * 押していない b 接点の停止ボタン。**押すと**落ちるので候補に出る。
     * 一方、押しても何も変わらないスイッチは雑音なので出さない。
     */
    const withStop = circuit(
      { PS1: POWER, S1: PB_NO, S2: PB_NC, NOISE: PB_NO, RY1: MY4N },
      [
        wire("PS1:plus", "S2:1"),
        wire("S2:2", "S1:1"),
        wire("S2:2", "RY1:9"),
        wire("S1:2", "RY1:14"),
        wire("RY1:5", "RY1:14"),
        wire("RY1:13", "PS1:zero"),
      ],
    );
    const pushed = simulate(withStop, componentRegistry, {
      pressedSwitches: new Set(["S1"]),
    });
    const held = simulate(withStop, componentRegistry, {
      pressedSwitches: new Set(),
      previousEnergizedRelays: pushed.energizedRelays,
    });
    const explanation = explainLoadPath(
      withStop,
      componentRegistry,
      held,
      new Set(),
      "RY1",
    );

    expect(explanation?.releases?.map((entry) => entry.componentId)).toEqual([
      "S2",
    ]);
    expect(explanation?.releases?.[0]).toMatchObject({
      action: "押す",
      releases: true,
      operated: false,
    });
  });

  it("非通電の負荷には落とし方を出さない", () => {
    expect(explain(straight, "RY1")?.releases).toBeUndefined();
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

describe("0V コモンの繋ぎ忘れ（design.md §5.3）", () => {
  it("両端が別々の電源に届いているときは、接点ではなく基準の問題だと言う", () => {
    const straddle = circuit({ PS1: POWER, PS2: POWER, RY1: MY4N }, [
      wire("PS1:plus", "RY1:14"),
      wire("RY1:13", "PS2:zero"),
    ]);
    const explanation = explain(straddle, "RY1");

    expect(explanation?.active).toBe(false);
    expect(explanation?.supplyMismatch).toBe(true);
    // 閉じれば届く接点は 1 枚も無い。足りないのは接点ではない
    expect(explanation?.gates).toEqual([]);
  });

  it("0V を繋げば通電し、この指摘は消える", () => {
    const common = circuit({ PS1: POWER, PS2: POWER, RY1: MY4N }, [
      wire("PS1:plus", "RY1:14"),
      wire("RY1:13", "PS2:zero"),
      wire("PS2:zero", "PS1:zero"),
    ]);
    const explanation = explain(common, "RY1");

    expect(explanation?.active).toBe(true);
    expect(explanation?.supplyMismatch).toBeUndefined();
  });

  it("単に接点が開いているだけの回路には出さない", () => {
    const explanation = explain(straight, "RY1");

    expect(explanation?.active).toBe(false);
    expect(explanation?.supplyMismatch).toBeUndefined();
    expect(explanation?.gates?.length).toBe(1);
  });
});

describe("押しボタンで起動した自己保持の起動経路（design.md §5.12）", () => {
  /** 起動ボタンと保持接点を並列にした、最も素直な自己保持 */
  const momentaryHold = circuit({ PS1: POWER, S1: PB_NO, RY1: MY4N }, [
    wire("PS1:plus", "S1:1"),
    wire("S1:2", "RY1:14"),
    wire("PS1:plus", "RY1:9"),
    wire("RY1:5", "RY1:14"),
    wire("RY1:13", "PS1:zero"),
  ]);

  /** 押して離し、自己保持だけで励磁が続いている状態まで進める */
  const held = () => {
    const idle = simulate(momentaryHold, componentRegistry, {
      pressedSwitches: new Set(),
    });
    const pressed = simulate(momentaryHold, componentRegistry, {
      pressedSwitches: new Set(["S1"]),
      previousEnergizedRelays: idle.energizedRelays,
    });
    const released = simulate(momentaryHold, componentRegistry, {
      pressedSwitches: new Set(),
      previousEnergizedRelays: pressed.energizedRelays,
    });
    return explainLoadPath(
      momentaryHold,
      componentRegistry,
      released,
      new Set(),
      "RY1",
    );
  };

  it("ボタンを離した後でも、どのボタンで起動したかを言える", () => {
    const explanation = held();

    expect(explanation?.active).toBe(true);
    // 保持経路には S1 が出てこない
    expect(traceOf(explanation?.supplyRun?.steps)).toEqual([
      "PS1(+24V)",
      "RY1(9→5→14)",
    ]);
    // 起動経路は S1 を通る。仮に押した状態で引き直して初めて出る
    expect(explanation?.startPath?.trigger?.componentId).toBe("S1");
    expect(traceOf(explanation?.startPath?.supply.steps)).toEqual([
      "PS1(+24V)",
      "S1(1→2)",
      "RY1(14)"
    ]);
  });

  it("仮に押したボタン自身は「切れた接点」に数えない", () => {
    /*
     * S1 が開いているのは離したからで、それは `trigger` がすでに言っている。
     * ここに重ねると「接点が切れたせいで経路が死んだ」と読めてしまう。
     */
    expect(held()?.startPath?.breaks).toEqual([]);
  });

  it("起動に使えるボタンが 2 個あるときは出さない（どちらか決まらない）", () => {
    const twoButtons = circuit(
      { PS1: POWER, S1: PB_NO, S2: PB_NO, RY1: MY4N },
      [
        wire("PS1:plus", "S1:1"),
        wire("S1:2", "RY1:14"),
        wire("PS1:plus", "S2:1"),
        wire("S2:2", "RY1:14"),
        wire("PS1:plus", "RY1:9"),
        wire("RY1:5", "RY1:14"),
        wire("RY1:13", "PS1:zero"),
      ],
    );
    const idle = simulate(twoButtons, componentRegistry, {
      pressedSwitches: new Set(),
    });
    const pressed = simulate(twoButtons, componentRegistry, {
      pressedSwitches: new Set(["S1"]),
      previousEnergizedRelays: idle.energizedRelays,
    });
    const released = simulate(twoButtons, componentRegistry, {
      pressedSwitches: new Set(),
      previousEnergizedRelays: pressed.energizedRelays,
    });
    const explanation = explainLoadPath(
      twoButtons,
      componentRegistry,
      released,
      new Set(),
      "RY1",
    );

    expect(explanation?.active).toBe(true);
    expect(explanation?.startPath).toBeUndefined();
  });

  it("オルタネートで起動した経路には trigger を付けない（今も ON のまま）", () => {
    const { explanation } = latched();

    expect(explanation?.startPath?.trigger).toBeUndefined();
    expect(explanation?.startPath?.breaks.length).toBeGreaterThan(0);
  });
});
