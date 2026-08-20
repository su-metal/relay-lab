/**
 * ラダー図の画像書き出し（design.md §5.16・§8.15）。
 *
 * 画面のラダー図（`LadderDialog`）は **CSS が引く横線と、図記号が自分の下地で
 * 作る切れ目**でできている。画面の外へ持ち出す 1 枚の絵にはその下地が無いので、
 * ここで**同じ骨組みを座標で組み直す。**
 *
 * **図の中身をここで作らない。** 段の並びも接点の形も断り書きも
 * `buildLadder()` が決めたものをそのまま描く。`rungText()` と同じ約束で、
 * 図と文と画像が別々の理解を持つと片方だけ直す事故が起きる。
 *
 * ## なぜ SVG か
 *
 * 画面の DOM を写し取る（html2canvas 系）のではなく、`LadderDiagram` から
 * 描き直す。理由は 2 つ。
 *
 * 1. **スクロールの外まで出る。** 画面のラダー図は横にも縦にもスクロールする
 *    ので、見えている部分だけを写すと段が途中で切れる
 * 2. **純粋関数として検証できる。** DOM も React も読まないので Vitest で
 *    段の数・端子番号・断り書きが絵に載っているかを確かめられる
 *
 * PNG が要るときは、この SVG をブラウザ側でラスタライズする
 * （`components/circuit/ladder-image.ts`）。**絵の定義は 1 つ**に保つ。
 *
 * ## 文字幅は測らずに見積もる
 *
 * DOM を読まない以上 `measureText()` は使えないので、全角 1.0em・半角 0.62em で
 * 見積もる。**少し広めに取る** —— 狭く見積もると呼び名が隣の接点へ被るが、
 * 広い分には間延びするだけで読めなくならない。
 */

import type {
  LadderContact,
  LadderDiagram,
  LadderExpr,
  LadderOutput,
  LadderRung,
} from "./ladder";
import { rungText } from "./ladder";

/**
 * 配色（`app/globals.css` の変数と同じ値）。
 *
 * **`var(--text)` を書かない。** 書き出した SVG はアプリの外で開かれるので、
 * CSS 変数はどこにも解決されず、線も文字も色を失う。
 */
const COLOR = {
  text: "#1f2937",
  muted: "#6b7280",
  panel: "#ffffff",
  border: "#d4d8e0",
  warnBg: "#fef3c7",
  warnBorder: "#fcd34d",
  warnText: "#92400e",
} as const;

const FONT_FAMILY =
  '"Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic UI", sans-serif';

/*
 * 寸法は画面の CSS（`LadderDialog.module.css`）と同じ数を使う。
 * 図記号の中心が上から 30px（呼び名 18px + 図記号 24px の半分）という
 * 1 つの数から、横線も並列の縦線も段番号の位置も出ている。
 */
const LABEL_H = 18;
const SYMBOL_W = 44;
const SYMBOL_H = 24;
const TERMINAL_H = 16;
/** 要素 1 個の高さ（呼び名 + 図記号 + 端子番号）。段 1 本の最小の高さでもある */
const ROW_H = LABEL_H + SYMBOL_H + TERMINAL_H;
/** 図記号の中心（要素の上端から） */
const SPINE_Y = LABEL_H + SYMBOL_H / 2;
const ELEMENT_PAD_X = 8;
/** 並列の枝の左右に空ける幅。ここに両端の縦線が立つ */
const PARALLEL_PAD_X = 12;
const RUNG_PAD_Y = 12;
/** 母線の太さ */
const RAIL_W = 2;
/** 段番号の欄（母線の外・左） */
const INDEX_W = 26;
const LINE_W = 2;

const LABEL_FONT = 11;
const TERMINAL_FONT = 10.5;
const BADGE_FONT = 9.5;
const INDEX_FONT = 10.5;
const NOTE_FONT = 11.5;
const TITLE_FONT = 14;
const META_FONT = 10.5;

const MARGIN = 20;
/** 断り書きが 1 行に収まらないほど狭い図でも、本文の幅を確保する */
const MIN_BODY_W = 460;

/** 全角として数える文字。半角カナ（FF61–FF9F）は含めない */
const WIDE_CHAR =
  /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹯！-｠￠-￦]/;

/** 半角 1 文字の幅（フォントサイズに対する比）。広めに取る */
const NARROW_RATIO = 0.62;

/** 文字列の幅の見積もり */
const measure = (text: string, fontSize: number): number => {
  let width = 0;
  for (const char of text) {
    width += WIDE_CHAR.test(char) ? fontSize : fontSize * NARROW_RATIO;
  }
  return width;
};

/** XML に置ける形へ。呼び名はユーザーが自由に付けられる（`<` も入る） */
const escapeXml = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const round = (value: number): number => Math.round(value * 100) / 100;

type TextOptions = {
  anchor?: "start" | "middle" | "end";
  size?: number;
  color?: string;
  weight?: number;
};

const text = (
  value: string,
  x: number,
  y: number,
  { anchor = "start", size = LABEL_FONT, color = COLOR.text, weight = 400 }: TextOptions = {},
): string =>
  `<text x="${round(x)}" y="${round(y)}" font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}">${escapeXml(value)}</text>`;

const line = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string = COLOR.text,
  width: number = LINE_W,
): string =>
  `<line x1="${round(x1)}" y1="${round(y1)}" x2="${round(x2)}" y2="${round(y2)}" stroke="${color}" stroke-width="${width}" stroke-linecap="round" />`;

const rect = (
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  radius = 0,
): string =>
  `<rect x="${round(x)}" y="${round(y)}" width="${round(width)}" height="${round(height)}" rx="${radius}" fill="${fill}" />`;

/** 接点・出力に添える札（「限時動作」「位置保持」）の文言 */
const badgesOf = (element: LadderContact | LadderOutput): string[] => {
  const badges: string[] = [];
  if (element.delay) {
    badges.push(element.delay === "on-delay" ? "限時動作" : "限時復帰");
  }
  if ("maintained" in element && element.maintained) badges.push("位置保持");
  return badges;
};

const badgeWidth = (label: string): number => measure(label, BADGE_FONT) + 8;

/**
 * 接点か出力か。**`kind` の値だけで見分ける** —— 接点（`no` / `nc`）と
 * 出力（`coil` / `lamp`）で値が重ならないので、判定を型番や部品の種類に
 * 戻さなくてよい
 */
const isContact = (
  element: LadderContact | LadderOutput,
): element is LadderContact =>
  element.kind === "no" || element.kind === "nc";

/** 呼び名の行（呼び名 + 札）の幅 */
const labelRowWidth = (label: string, badges: readonly string[]): number =>
  measure(label, LABEL_FONT) +
  badges.reduce((total, badge) => total + badgeWidth(badge) + 4, 0);

const terminalText = (labels: readonly [string, string]): string =>
  `${labels[0]}-${labels[1]}`;

/**
 * 要素 1 個の幅。**中身で決まる** —— 呼び名も端子番号も削らないので、
 * 長い呼び名を付けた接点はその分だけ広くなる。
 */
const elementWidth = (element: LadderContact | LadderOutput): number =>
  Math.max(
    SYMBOL_W,
    labelRowWidth(element.label, badgesOf(element)),
    measure(terminalText(element.terminalLabels), TERMINAL_FONT),
  ) +
  ELEMENT_PAD_X * 2;

type Size = { width: number; height: number };

/** 式が要る大きさ。直列は横に足し、並列は縦に積む */
const sizeOfExpr = (expr: LadderExpr): Size => {
  switch (expr.kind) {
    case "contact":
      return { width: elementWidth(expr.contact), height: ROW_H };
    case "series": {
      const sizes = expr.items.map(sizeOfExpr);
      return {
        width: sizes.reduce((total, size) => total + size.width, 0),
        height: Math.max(...sizes.map((size) => size.height)),
      };
    }
    case "parallel": {
      const sizes = expr.items.map(sizeOfExpr);
      return {
        width:
          Math.max(...sizes.map((size) => size.width)) + PARALLEL_PAD_X * 2,
        height: sizes.reduce((total, size) => total + size.height, 0),
      };
    }
  }
};

/** 接点 1 枚の図記号。画面の `ContactView` と同じ形（JIS の書き方） */
const contactSymbol = (x: number, y: number, kind: "no" | "nc"): string => {
  const parts = [
    line(x, y + 12, x + 15, y + 12),
    line(x + 15, y + 4, x + 15, y + 20),
    line(x + 29, y + 4, x + 29, y + 20),
    line(x + 29, y + 12, x + 44, y + 12),
  ];
  // b 接点は 2 本の縦線に斜線を重ねる
  if (kind === "nc") parts.push(line(x + 12, y + 21, x + 32, y + 3));
  return parts.join("");
};

/** 出力の図記号。コイルは括弧 —( )—、ランプは丸に × */
const outputSymbol = (x: number, y: number, kind: "coil" | "lamp"): string => {
  const parts = [
    line(x, y + 12, x + 14, y + 12),
    line(x + 30, y + 12, x + 44, y + 12),
  ];
  if (kind === "coil") {
    parts.push(
      `<path d="M${x + 18} ${y + 4} A 9 9 0 0 0 ${x + 18} ${y + 20}" fill="none" stroke="${COLOR.text}" stroke-width="${LINE_W}" stroke-linecap="round" />`,
      `<path d="M${x + 26} ${y + 4} A 9 9 0 0 1 ${x + 26} ${y + 20}" fill="none" stroke="${COLOR.text}" stroke-width="${LINE_W}" stroke-linecap="round" />`,
    );
  } else {
    parts.push(
      `<circle cx="${x + 22}" cy="${y + 12}" r="8" fill="none" stroke="${COLOR.text}" stroke-width="${LINE_W}" />`,
      line(x + 16.5, y + 6.5, x + 27.5, y + 17.5),
      line(x + 27.5, y + 6.5, x + 16.5, y + 17.5),
    );
  }
  return parts.join("");
};

/**
 * 要素 1 個（接点または出力）を描く。
 *
 * **図記号の下に下地を敷く**のが要点。段の横線は先に引いてあるので、
 * 敷かないと線が接点の内側を突き抜け、開いている接点が閉じて見える
 * （画面側で `.symbol` に `background` を持たせているのと同じ理由）。
 */
const drawElement = (
  element: LadderContact | LadderOutput,
  x: number,
  top: number,
): string => {
  const width = elementWidth(element);
  const badges = badgesOf(element);
  const parts: string[] = [];

  // 呼び名と札。まとめて中央へ寄せる
  const rowWidth = labelRowWidth(element.label, badges);
  let cursor = x + (width - rowWidth) / 2;
  parts.push(
    text(element.label, cursor, top + 13, { size: LABEL_FONT, weight: 600 }),
  );
  cursor += measure(element.label, LABEL_FONT);
  for (const badge of badges) {
    const badgeW = badgeWidth(badge);
    cursor += 4;
    parts.push(
      rect(cursor, top + 2, badgeW, 14, COLOR.warnBg, 4),
      `<rect x="${round(cursor)}" y="${top + 2}" width="${round(badgeW)}" height="14" rx="4" fill="none" stroke="${COLOR.warnBorder}" stroke-width="1" />`,
      text(badge, cursor + badgeW / 2, top + 12, {
        anchor: "middle",
        size: BADGE_FONT,
        color: COLOR.warnText,
        weight: 600,
      }),
    );
    cursor += badgeW;
  }

  // 図記号（下地 → 線の順）
  const symbolX = x + (width - SYMBOL_W) / 2;
  const symbolY = top + LABEL_H;
  parts.push(rect(symbolX, symbolY, SYMBOL_W, SYMBOL_H, COLOR.panel));
  parts.push(
    isContact(element)
      ? contactSymbol(symbolX, symbolY, element.kind)
      : outputSymbol(symbolX, symbolY, element.kind),
  );

  // 実端子番号。**ここを落とすと実配線と照らせなくなる**（design.md §8.15）
  parts.push(
    text(terminalText(element.terminalLabels), x + width / 2, top + 53, {
      anchor: "middle",
      size: TERMINAL_FONT,
      color: COLOR.muted,
    }),
  );

  return parts.join("");
};

/**
 * 条件式を描く。
 *
 * 呼び出し側が「この式が乗る横線」を先に引いてある前提で、式は自分の要素と
 * **内側の**線だけを描く（画面側で `.condition::before` が線を引き、
 * 要素は下地で切れ目を作るのと同じ役割分担）。
 */
const drawExpr = (
  expr: LadderExpr,
  x: number,
  top: number,
  availWidth: number,
): string => {
  switch (expr.kind) {
    case "contact":
      return drawElement(expr.contact, x, top);
    case "series": {
      const parts: string[] = [];
      let cursor = x;
      for (const item of expr.items) {
        const size = sizeOfExpr(item);
        parts.push(drawExpr(item, cursor, top, size.width));
        cursor += size.width;
      }
      return parts.join("");
    }
    case "parallel": {
      const parts: string[] = [];
      const innerX = x + PARALLEL_PAD_X;
      const innerWidth = availWidth - PARALLEL_PAD_X * 2;
      let cursor = top;
      const spines: number[] = [];
      for (const item of expr.items) {
        const size = sizeOfExpr(item);
        const spine = cursor + SPINE_Y;
        spines.push(spine);
        // 枝の横線は枝の幅いっぱいに引く（短い枝も両端の縦線まで届く）
        parts.push(line(innerX, spine, innerX + innerWidth, spine));
        parts.push(drawExpr(item, innerX, cursor, innerWidth));
        cursor += size.height;
      }
      // 両端の縦線は最初の枝の中心から最後の枝の中心まで
      const first = spines[0];
      const last = spines[spines.length - 1];
      parts.push(line(x + 1, first, x + 1, last));
      parts.push(line(x + availWidth - 1, first, x + availWidth - 1, last));
      return parts.join("");
    }
  }
};

/** 断り書きの折り返し。日本語はどこでも折れるが、行頭に来てはいけない字は送らない */
const NO_LINE_START = "。、）」』】〉》”’,.:;!?！？」";

const wrapText = (
  value: string,
  maxWidth: number,
  fontSize: number,
): string[] => {
  const lines: string[] = [];
  let current = "";
  let width = 0;
  for (const char of value) {
    const charWidth = measure(char, fontSize);
    if (current !== "" && width + charWidth > maxWidth) {
      if (NO_LINE_START.includes(char)) {
        // 行頭に置けない字は今の行に押し込む（1 文字ぶんのはみ出しは許す）
        lines.push(current + char);
        current = "";
        width = 0;
        continue;
      }
      lines.push(current);
      current = "";
      width = 0;
    }
    current += char;
    width += charWidth;
  }
  if (current !== "") lines.push(current);
  return lines;
};

const pad2 = (value: number): string => String(value).padStart(2, "0");

/**
 * 書き出すファイル名（`relay-lab-ladder-20260820-1530.png`）。
 *
 * `circuitFileName()` と同じ作り。日時を入れるのは、同じ回路を何度も
 * 書き出したときにどれが新しいのか分からなくなるため。**日本語を含めない。**
 */
export const ladderFileName = (
  extension: "svg" | "png",
  now: Date = new Date(),
): string => {
  const date = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
  const time = `${pad2(now.getHours())}${pad2(now.getMinutes())}`;
  return `relay-lab-ladder-${date}-${time}.${extension}`;
};

const formatStamp = (now: Date): string =>
  `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`;

export type LadderSvgOptions = {
  /**
   * 図の右上に添える日時。
   *
   * **時計はここで読まない**（CLAUDE.md 設計原則 1 と同じ約束）。呼び出し側が渡す。
   */
  generatedAt?: Date;
  /** 図の見出し */
  title?: string;
};

/** 図の縦方向の内訳。テストから寸法を確かめられるよう export する */
export type LadderSvgSize = { width: number; height: number };

const rungHeight = (rung: LadderRung): number => {
  const conditionHeight = rung.condition
    ? sizeOfExpr(rung.condition).height
    : ROW_H;
  return Math.max(ROW_H, conditionHeight) + RUNG_PAD_Y * 2;
};

/**
 * ラダー図を 1 枚の SVG にする。
 *
 * 段が 1 本も無いときも「段が無い」と書いた絵を返す —— 空の絵を返すと
 * 「書き出しに失敗した」のか「出す段が無い」のか受け取った側に分からない。
 */
export const renderLadderSvg = (
  diagram: LadderDiagram,
  { generatedAt = new Date(), title = "ラダー図" }: LadderSvgOptions = {},
): string => {
  const { rungs, notes } = diagram;

  // 1. 幅を決める。段の幅は中身（接点の枚数と呼び名の長さ）で決まる
  const rungWidths = rungs.map((rung) => {
    const outputWidth = elementWidth(rung.output);
    if (rung.blocked) {
      return measure(rung.blocked, NOTE_FONT) + 20 + 8 + outputWidth;
    }
    const conditionWidth = rung.condition
      ? sizeOfExpr(rung.condition).width
      : SYMBOL_W;
    return conditionWidth + outputWidth;
  });
  /** 母線の内側の幅。すべての段で共通にして出力を右端で揃える */
  const contentWidth = Math.max(0, ...rungWidths);
  const ladderWidth = INDEX_W + RAIL_W * 2 + contentWidth;
  const bodyWidth = Math.max(MIN_BODY_W, ladderWidth);

  const parts: string[] = [];

  // 2. 見出し。**いつの配線から起こした図か**を必ず添える。
  //    ラダー図は保存対象ではない派生物なので（CLAUDE.md 設計原則 10）、
  //    画像として持ち出した瞬間から実配線と食い違い得る
  let y = MARGIN;
  parts.push(
    text(title, MARGIN, y + TITLE_FONT, { size: TITLE_FONT, weight: 700 }),
  );
  parts.push(
    text(
      `${formatStamp(generatedAt)} 時点の配線から生成`,
      MARGIN + bodyWidth,
      y + TITLE_FONT,
      { anchor: "end", size: META_FONT, color: COLOR.muted },
    ),
  );
  y += TITLE_FONT + 8;
  parts.push(line(MARGIN, y, MARGIN + bodyWidth, y, COLOR.border, 1));
  y += 16;

  // 3. 段
  const ladderTop = y;
  const railLeftX = MARGIN + INDEX_W + RAIL_W / 2;
  const railRightX = railLeftX + RAIL_W / 2 + contentWidth + RAIL_W / 2;
  const contentX = MARGIN + INDEX_W + RAIL_W;

  if (rungs.length === 0) {
    parts.push(
      text(
        "出力（コイル・ランプ）が無いため、段がありません。",
        MARGIN,
        y + NOTE_FONT,
        { size: NOTE_FONT, color: COLOR.muted },
      ),
    );
    y += NOTE_FONT + 8;
  } else {
    rungs.forEach((rung, index) => {
      const height = rungHeight(rung);
      const top = y + RUNG_PAD_Y;
      const spine = top + SPINE_Y;
      const outputWidth = elementWidth(rung.output);
      const outputX = contentX + contentWidth - outputWidth;

      parts.push(
        text(String(index + 1), MARGIN + INDEX_W - 8, spine + 4, {
          anchor: "end",
          size: INDEX_FONT,
          color: COLOR.muted,
        }),
      );

      if (rung.blocked) {
        // 図にできなかった段。理由を線の代わりに置く
        const boxWidth = outputX - contentX - 8;
        const boxHeight = Math.max(ROW_H, NOTE_FONT * 2);
        parts.push(rect(contentX, top, boxWidth, boxHeight, COLOR.warnBg));
        parts.push(
          line(
            contentX + 1,
            top,
            contentX + 1,
            top + boxHeight,
            COLOR.warnBorder,
          ),
        );
        const lines = wrapText(rung.blocked, boxWidth - 20, NOTE_FONT);
        const textTop = top + boxHeight / 2 - ((lines.length - 1) * 16) / 2 + 4;
        lines.forEach((entry, lineIndex) => {
          parts.push(
            text(entry, contentX + 10, textTop + lineIndex * 16, {
              size: NOTE_FONT,
              color: COLOR.warnText,
            }),
          );
        });
      } else {
        // 母線から出力までの横線を先に通し、その上に条件を置く
        parts.push(line(contentX, spine, outputX, spine));
        if (rung.condition) {
          const size = sizeOfExpr(rung.condition);
          parts.push(drawExpr(rung.condition, contentX, top, size.width));
        }
      }

      parts.push(drawElement(rung.output, outputX, top));
      y += height;
    });

    // 母線。段の枠線を積むのではなく 1 本ずつ引く（画像では切れ目を作らない）
    parts.push(line(railLeftX, ladderTop, railLeftX, y));
    parts.push(line(railRightX, ladderTop, railRightX, y));
  }

  // 4. 断り書き。**画像にも必ず載せる** —— ダイオードや調光を図に出して
  //    いないこと、電源を 1 組の母線に束ねたことは、図だけを見た人に
  //    伝わらないと誤読になる
  if (notes.length > 0) {
    y += 16;
    for (const note of notes) {
      const lines = wrapText(note, bodyWidth - 10, NOTE_FONT);
      lines.forEach((entry, lineIndex) => {
        parts.push(
          text(entry, MARGIN + 10, y + NOTE_FONT + lineIndex * 17, {
            size: NOTE_FONT,
            color: COLOR.muted,
          }),
        );
      });
      const blockHeight = lines.length * 17;
      parts.push(
        line(MARGIN, y, MARGIN, y + blockHeight, COLOR.border, LINE_W),
      );
      y += blockHeight + 6;
    }
  }

  const width = bodyWidth + MARGIN * 2;
  const height = y + MARGIN;

  /*
   * 図そのものは読み上げられないので、段の文（`rungText()`）を `<desc>` に
   * 添える。画面の視覚障害者向けテキストと**同じ 1 箇所から出す**
   */
  const description = [
    ...rungs.map((rung, index) => `${index + 1}. ${rungText(rung)}`),
    ...notes,
  ].join("\n");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${round(width)}" height="${round(height)}" viewBox="0 0 ${round(width)} ${round(height)}" font-family='${FONT_FAMILY}'>`,
    `<title>${escapeXml(title)}</title>`,
    `<desc>${escapeXml(description)}</desc>`,
    rect(0, 0, width, height, COLOR.panel),
    ...parts,
    "</svg>",
    "",
  ].join("\n");
};
