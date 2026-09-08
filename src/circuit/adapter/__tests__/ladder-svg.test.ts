/**
 * ラダー図の画像書き出しの検証（design.md §5.16・§8.15）。
 *
 * ここで守りたいのは 4 つ。
 *
 * 1. **実端子番号が絵に載る。** 画像にした瞬間に番号が落ちると、
 *    一般的なラダー図と変わらなくなりキャンバスの配線と照らせない（§8.15）
 * 2. **断り書きが絵に載る。** ダイオードや調光を図に出していないこと、
 *    電源を 1 組の母線に束ねたことは、画像だけを見た人には伝わらない
 * 3. **図が画用紙からはみ出さない。** 段の幅は中身（接点の枚数と呼び名の
 *    長さ）で決まるので、幅を数え違えると長い呼び名の接点が切れる
 * 4. **アプリの外で開いても色が付く。** CSS 変数（`var(--text)`）を書くと
 *    書き出した SVG では解決されず、線も文字も消える
 *
 * 実端子番号（MY4N のコイル 14/13・第1接点 NC=1 / NO=5 / COM=9）で回路を
 * 組み、`buildLadder()` の結果をそのまま絵にして確かめる。
 */

import { describe, expect, it } from "vitest";

import { buildLadder } from "@/circuit/adapter/ladder";
import type { LadderDiagram } from "@/circuit/adapter/ladder";
import {
  ladderFileName,
  renderLadderSvg,
} from "@/circuit/adapter/ladder-svg";
import { componentRegistry } from "@/circuit/definitions";
import type { CircuitConnection, CircuitDocument } from "@/circuit/types";

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
const LAMP = "lamp-dc24v";
const DIODE = "diode-generic";

/** 生成日時を固定する。**時計はここで読む**（レンダラは受け取るだけ） */
const AT = new Date(2026, 7, 20, 15, 30);

const svgOf = (document: CircuitDocument): string =>
  renderLadderSvg(buildLadder(document, componentRegistry), {
    generatedAt: AT,
  });

/** 停止付き自己保持回路（`ladder.test.ts` と同じ配線） */
const selfHold = (): CircuitDocument =>
  circuit({ PS1: POWER, S1: PB_NO, S2: PB_NC, RY1: MY4N }, [
    wire("PS1:plus", "S2:1"),
    wire("S2:2", "S1:1"),
    wire("S2:2", "RY1:9"),
    wire("S1:2", "RY1:14"),
    wire("RY1:5", "RY1:14"),
    wire("RY1:13", "PS1:zero"),
  ]);

/** `<text>` の中身だけを順に取り出す */
const textsOf = (svg: string): string[] =>
  [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((match) => match[1]);

const sizeOf = (svg: string): { width: number; height: number } => {
  const match = svg.match(/<svg[^>]*width="([\d.]+)" height="([\d.]+)"/);
  if (!match) throw new Error("SVG の大きさを読めません");
  return { width: Number(match[1]), height: Number(match[2]) };
};

describe("renderLadderSvg", () => {
  it("接点と出力の呼び名・実端子番号を絵に載せる", () => {
    const texts = textsOf(svgOf(selfHold()));

    // 呼び名（S2 → S1 ∥ RY1 → RY1 コイル）
    expect(texts).toContain("S2");
    expect(texts).toContain("S1");
    expect(texts).toContain("RY1");
    // **実端子番号。ここが落ちたら画像として用を成さない**
    expect(texts).toContain("1-2");
    expect(texts).toContain("9-5");
    expect(texts).toContain("14-13");
  });

  it("段の数だけ番号が振られ、上から順に並ぶ", () => {
    const document = circuit({ PS1: POWER, S1: PB_NO, RY1: MY4N, PL1: LAMP }, [
      wire("PS1:plus", "S1:1"),
      wire("S1:2", "RY1:14"),
      wire("RY1:13", "PS1:zero"),
      wire("PS1:plus", "RY1:10"),
      wire("RY1:6", "PL1:1"),
      wire("PL1:2", "PS1:zero"),
    ]);

    const svg = svgOf(document);
    const texts = textsOf(svg);

    expect(texts).toContain("1");
    expect(texts).toContain("2");
    // 段番号 1（リレー）が段番号 2（ランプ）より上にある
    const yOf = (label: string): number => {
      const match = svg.match(
        new RegExp(`<text x="[\\d.]+" y="([\\d.]+)"[^>]*>${label}</text>`),
      );
      if (!match) throw new Error(`${label} が絵に無い`);
      return Number(match[1]);
    };
    expect(yOf("1")).toBeLessThan(yOf("2"));
  });

  it("限時接点の札を絵に載せる（図記号だけでは読めないため）", () => {
    const document = circuit({ PS1: POWER, S1: PB_NO, TR1: "timer-on-delay" }, [
      wire("PS1:plus", "S1:1"),
      wire("S1:2", "TR1:2"),
      wire("TR1:7", "PS1:zero"),
    ]);

    expect(textsOf(svgOf(document))).toContain("限時動作");
  });

  it("断り書きを絵に載せる（画像だけを見た人に伝わらないため）", () => {
    const document = circuit({ PS1: POWER, RY1: MY4N, D1: DIODE }, [
      wire("PS1:plus", "RY1:14"),
      wire("RY1:13", "PS1:zero"),
      wire("D1:A", "RY1:13"),
      wire("D1:K", "RY1:14"),
    ]);

    const diagram = buildLadder(document, componentRegistry);
    const svg = renderLadderSvg(diagram, { generatedAt: AT });
    const rendered = textsOf(svg).join("");

    expect(diagram.notes.length).toBeGreaterThan(0);
    // 折り返して複数行になるので、行を繋いだ上で頭の一節を探す
    expect(rendered).toContain("ダイオードは図に出していません");
  });

  it("図にできなかった段は理由を絵に載せる", () => {
    // 0V 側へ繋いでいないコイル
    const document = circuit({ PS1: POWER, RY1: MY4N }, [
      wire("PS1:plus", "RY1:14"),
    ]);

    const rendered = textsOf(svgOf(document)).join("");

    expect(rendered).toContain("母線に届いていません");
    // 段にできなくても出力の端子番号は残す
    expect(textsOf(svgOf(document))).toContain("14-13");
  });

  it("いつの配線から起こした図かを絵に載せる", () => {
    // ラダー図は保存対象ではない派生物で、画像は撮った時点のスナップショット
    expect(textsOf(svgOf(selfHold()))).toContain(
      "2026-08-20 15:30 時点の配線から生成",
    );
  });

  it("呼び名が長いほど図が広くなり、中身がはみ出さない", () => {
    const narrow = svgOf(selfHold());
    const wideDocument = selfHold();
    wideDocument.components = wideDocument.components.map((component) =>
      component.id === "S1"
        ? { ...component, label: "運転開始押しボタン（現場盤・北側）1号機予備回路用の長い呼び名" }
        : component,
    );
    const wide = svgOf(wideDocument);

    const width = sizeOf(wide).width;
    expect(width).toBeGreaterThan(sizeOf(narrow).width);

    // 一番右の文字（右端揃えなので終端が右端）でも画用紙の中に収まる
    const xs = [...wide.matchAll(/<text x="([\d.]+)"/g)].map((match) =>
      Number(match[1]),
    );
    expect(Math.max(...xs)).toBeLessThanOrEqual(width);
  });

  it("段が 1 本も無いときも「段が無い」と描く（空の絵を返さない）", () => {
    const empty: LadderDiagram = { rungs: [], notes: [] };
    const rendered = textsOf(renderLadderSvg(empty, { generatedAt: AT })).join("");

    expect(rendered).toContain("段がありません");
    expect(sizeOf(renderLadderSvg(empty, { generatedAt: AT })).height).toBeGreaterThan(0);
  });

  it("アプリの外でも色が付く（CSS 変数を書かない）", () => {
    const svg = svgOf(selfHold());

    expect(svg).not.toContain("var(--");
    expect(svg).toContain('stroke="#1f2937"');
  });

  it("呼び名に < が入っても壊れない XML を返す", () => {
    const document = selfHold();
    document.components = document.components.map((component) =>
      component.id === "S1" ? { ...component, label: '<S1 & "予備">' } : component,
    );

    const svg = svgOf(document);

    expect(svg).toContain("&lt;S1 &amp; &quot;予備&quot;&gt;");
    // 開いた `<text>` の数と閉じた数が合う（生の < が混ざっていない）
    expect((svg.match(/<text/g) ?? []).length).toBe(
      (svg.match(/<\/text>/g) ?? []).length,
    );
  });

  it("読み上げ用に段の文を添える（図と文を別々に組み立てない）", () => {
    const svg = svgOf(selfHold());
    const desc = svg.match(/<desc>([\s\S]*?)<\/desc>/);

    expect(desc?.[1]).toContain(
      "S2 1-2[b] — (S1 1-2[a] ∥ RY1 9-5[a]) → RY1 コイル 14-13",
    );
  });
});

describe("ladderFileName", () => {
  it("日時付きで、日本語を含まない名前を返す", () => {
    expect(ladderFileName("png", AT)).toBe("relay-lab-ladder-20260820-1530.png");
    expect(ladderFileName("svg", AT)).toBe("relay-lab-ladder-20260820-1530.svg");
  });
});
