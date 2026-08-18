/**
 * 実体配線 → ラダー図の変換の検証（design.md §5.16）。
 *
 * ここで守りたいのは 4 つ。
 *
 * 1. **自己保持が「並列の枝」として出る。** 起動ボタンと保持接点が横に並ぶ形は
 *    ラダー図の読み方そのもので、ここが直列に潰れたら図としての意味が無い
 * 2. **接点がコイルのどちら側にあっても同じ段になる。** 実配線では 0V 側に
 *    接点を入れる書き方も普通にあり、ラダー図は条件を左へ集める
 * 3. **接点の開閉状態を織り込まない。** ラダー図は回路の論理であって
 *    スナップショットではない。b 接点は「今閉じているから」ではなく b 接点として出る
 * 4. **出せないときは黙って近い図を出さない。** 電源に届いていない配線と
 *    ブリッジ回路は、そう言って諦める
 *
 * UI を起動せず、実端子番号（MY4N のコイル 14/13・第1接点 NC=1 / NO=5 / COM=9）で
 * 回路を組んで検証する。
 */

import { describe, expect, it } from "vitest";

import { buildLadder, rungText } from "@/circuit/adapter/ladder";
import { componentRegistry } from "@/circuit/definitions";
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

/**
 * 部品は置いた順に上から下へ並ぶようにしておく（段の順序は図面での位置で決まる）。
 */
const circuit = (
  components: Record<string, string>,
  connections: CircuitConnection[],
): CircuitDocument => ({
  version: 1,
  components: Object.entries(components).map(([id, definitionId], index) => ({
    id,
    definitionId,
    label: id,
    position: { x: 0, y: index * 100 },
  })),
  connections,
  viewport: { x: 0, y: 0, zoom: 1 },
});

const POWER = "power-dc24v";
const PB_NO = "switch-pushbutton-no";
const PB_NC = "switch-pushbutton-nc";
const MY4N = "omron-my4n-dc24";
const G7L = "omron-g7l-1a-b-dc24";
const LAMP = "lamp-dc24v";
const TIMER = "timer-on-delay";
const DIODE = "diode-generic";

const ladderOf = (document: CircuitDocument) =>
  buildLadder(document, componentRegistry);

describe("buildLadder", () => {
  it("停止付き自己保持回路を 1 段のラダー図にする", () => {
    /*
     * `self-hold.test.ts` と同じ配線（自己保持接点がコイルの + 側）。
     * +24V → S2(B接点) → [S1(A接点) ∥ RY1 の a 接点] → コイル → 0V
     */
    const document = circuit({ PS1: POWER, S1: PB_NO, S2: PB_NC, RY1: MY4N }, [
      wire("PS1:plus", "S2:1"),
      wire("S2:2", "S1:1"),
      wire("S2:2", "RY1:9"),
      wire("S1:2", "RY1:14"),
      wire("RY1:5", "RY1:14"),
      wire("RY1:13", "PS1:zero"),
    ]);

    const ladder = ladderOf(document);

    expect(ladder.rungs).toHaveLength(1);
    expect(rungText(ladder.rungs[0])).toBe(
      "S2 1-2[b] — (S1 1-2[a] ∥ RY1 9-5[a]) → RY1 コイル 14-13",
    );
    // 起動ボタンと保持接点が「並列」であること自体を型でも確かめる
    const condition = ladder.rungs[0].condition;
    expect(condition?.kind).toBe("series");
    expect(
      condition?.kind === "series" ? condition.items[1].kind : undefined,
    ).toBe("parallel");
    expect(ladder.rungs[0].movedFromZeroSide).toBe(false);
  });

  it("自己保持をコイルの 0V 側に組んでも同じ条件になり、移したことを断る", () => {
    /*
     * 同じ動作を − 側で組んだ書き方。実配線では接点がコイルの右にあるが、
     * ラダー図は条件を出力の左へ集める。
     */
    const document = circuit({ PS1: POWER, S1: PB_NO, S2: PB_NC, RY1: MY4N }, [
      wire("PS1:plus", "RY1:14"),
      wire("RY1:13", "S1:1"),
      wire("RY1:13", "RY1:9"),
      wire("S1:2", "S2:1"),
      wire("RY1:5", "S2:1"),
      wire("S2:2", "PS1:zero"),
    ]);

    const ladder = ladderOf(document);

    expect(ladder.rungs).toHaveLength(1);
    expect(rungText(ladder.rungs[0])).toBe(
      "(S1 1-2[a] ∥ RY1 9-5[a]) — S2 1-2[b] → RY1 コイル 14-13",
    );
    expect(ladder.rungs[0].movedFromZeroSide).toBe(true);
    expect(ladder.notes.some((note) => note.includes("左へ移して"))).toBe(true);
  });

  it("母線に直結した負荷は条件なしの段になる", () => {
    const document = circuit({ PS1: POWER, PL1: LAMP }, [
      wire("PS1:plus", "PL1:1"),
      wire("PL1:2", "PS1:zero"),
    ]);

    expect(rungText(ladderOf(document).rungs[0])).toBe(
      "（条件なし） → PL1 ランプ 1-2",
    );
  });

  it("負荷の数だけ段が出て、図面の上にある部品が先に来る", () => {
    const document = circuit(
      { PS1: POWER, S1: PB_NO, RY1: MY4N, PL1: LAMP },
      [
        wire("PS1:plus", "S1:1"),
        wire("S1:2", "RY1:14"),
        wire("RY1:13", "PS1:zero"),
        // ランプはリレーの a 接点で点く（第 2 接点 COM=10 / NO=6）
        wire("PS1:plus", "RY1:10"),
        wire("RY1:6", "PL1:1"),
        wire("PL1:2", "PS1:zero"),
      ],
    );

    const ladder = ladderOf(document);

    expect(ladder.rungs.map(rungText)).toEqual([
      "S1 1-2[a] → RY1 コイル 14-13",
      "RY1 10-6[a] → PL1 ランプ 1-2",
    ]);
  });

  it("タイマーの接点は限時接点として出る", () => {
    const document = circuit({ PS1: POWER, T1: TIMER, PL1: LAMP }, [
      wire("PS1:plus", "T1:1"),
      wire("T1:2", "PS1:zero"),
      wire("PS1:plus", "T1:3"),
      wire("T1:4", "PL1:1"),
      wire("PL1:2", "PS1:zero"),
    ]);

    const ladder = ladderOf(document);

    expect(ladder.rungs.map(rungText)).toEqual([
      "（条件なし） → T1 コイル 1-2",
      "T1 3-4[限a] → PL1 ランプ 1-2",
    ]);
    expect(ladder.rungs[0].output.delay).toBe("on-delay");
  });

  it("b 接点は今閉じていても b 接点として出る（状態を織り込まない）", () => {
    // 非励磁の MY4N の COM(9)–NC(1) は導通しているが、ラダー図では b 接点
    const document = circuit({ PS1: POWER, RY1: MY4N, PL1: LAMP }, [
      wire("PS1:plus", "RY1:9"),
      wire("RY1:1", "PL1:1"),
      wire("PL1:2", "PS1:zero"),
    ]);

    // コイルは配線していないので、見るのはランプの段
    expect(ladderOf(document).rungs.map(rungText)).toContain(
      "RY1 9-1[b] → PL1 ランプ 1-2",
    );
  });

  it("a 接点しか持たないリレーは b 接点の枝を持たない", () => {
    // G7L は b 接点の端子が実機に無い（CLAUDE.md 設計原則 6）
    // G7L-1A-B の接点は 4（COM）–6（NO）、コイルは 0 / 1
    const document = circuit({ PS1: POWER, KM1: G7L, PL1: LAMP }, [
      wire("PS1:plus", "KM1:4"),
      wire("KM1:6", "PL1:1"),
      wire("PL1:2", "PS1:zero"),
    ]);

    const ladder = ladderOf(document);

    expect(ladder.rungs.map(rungText)).toContain("KM1 4-6[a] → PL1 ランプ 1-2");
    expect(ladder.rungs.map(rungText).join("\n")).not.toContain("[b]");
  });

  it("配線が電源に届いていない負荷は、届いていない側を言って諦める", () => {
    const document = circuit({ PS1: POWER, S1: PB_NO, RY1: MY4N }, [
      wire("PS1:plus", "S1:1"),
      wire("S1:2", "RY1:14"),
      // コイルの 13 が 0V へ戻っていない
    ]);

    const ladder = ladderOf(document);

    expect(ladder.rungs[0].condition).toBeUndefined();
    expect(ladder.rungs[0].blocked).toContain("0V 側の母線に届いていません");
  });

  it("直列と並列に分解できない配線（ブリッジ）は、そう言って諦める", () => {
    /*
     * S1・S2・S3・S4 の 4 枚でブリッジを組み、渡りに S5 を入れる。
     * どの接点も直列にも並列にもならないので、ラダー図の形にはできない。
     */
    const document = circuit(
      {
        PS1: POWER,
        S1: PB_NO,
        S2: PB_NO,
        S3: PB_NO,
        S4: PB_NO,
        S5: PB_NO,
        RY1: MY4N,
      },
      [
        wire("PS1:plus", "S1:1"),
        wire("PS1:plus", "S2:1"),
        // 左上 → 中央左、左下 → 中央右
        wire("S1:2", "S3:1"),
        wire("S2:2", "S4:1"),
        // 渡り
        wire("S1:2", "S5:1"),
        wire("S5:2", "S2:2"),
        // 合流してコイルへ
        wire("S3:2", "RY1:14"),
        wire("S4:2", "RY1:14"),
        wire("RY1:13", "PS1:zero"),
      ],
    );

    const ladder = ladderOf(document);

    expect(ladder.rungs[0].condition).toBeUndefined();
    expect(ladder.rungs[0].blocked).toContain("ブリッジ");
  });

  it("行き止まりの接点は図に出ない", () => {
    // RY1 の第 2 接点は片側しか配線していない（電流が通らない）
    const document = circuit({ PS1: POWER, S1: PB_NO, RY1: MY4N }, [
      wire("PS1:plus", "S1:1"),
      wire("S1:2", "RY1:14"),
      wire("RY1:13", "PS1:zero"),
      wire("S1:2", "RY1:10"),
    ]);

    expect(rungText(ladderOf(document).rungs[0])).toBe(
      "S1 1-2[a] → RY1 コイル 14-13",
    );
  });

  it("ダイオードは図に出さず、出していないことを断る", () => {
    const document = circuit({ PS1: POWER, RY1: MY4N, D1: DIODE }, [
      wire("PS1:plus", "RY1:14"),
      wire("RY1:13", "PS1:zero"),
      // 還流ダイオード（カソードをコイルの + 側へ）
      wire("D1:k", "RY1:14"),
      wire("D1:a", "RY1:13"),
    ]);

    const ladder = ladderOf(document);

    expect(rungText(ladder.rungs[0])).toBe("（条件なし） → RY1 コイル 14-13");
    expect(ladder.notes.some((note) => note.includes("ダイオード"))).toBe(true);
  });

  it("電源が無ければ段は出せず、そのことを断る", () => {
    const document = circuit({ RY1: MY4N }, []);
    const ladder = ladderOf(document);

    expect(ladder.rungs[0].blocked).toBeDefined();
    expect(ladder.notes.some((note) => note.includes("電源が置かれていない"))).toBe(
      true,
    );
  });

  it("端子台は素通りし、図には出ない", () => {
    const document = circuit({ PS1: POWER, TB1: "terminal-block-6p", PL1: LAMP }, [
      wire("PS1:plus", "TB1:1"),
      wire("TB1:2", "PL1:1"),
      wire("PL1:2", "PS1:zero"),
    ]);

    expect(rungText(ladderOf(document).rungs[0])).toBe(
      "（条件なし） → PL1 ランプ 1-2",
    );
  });

  it("部品が 1 個も無ければ段も断り書きの電源分だけになる", () => {
    const ladder = ladderOf(circuit({}, []));
    expect(ladder.rungs).toHaveLength(0);
  });
});
