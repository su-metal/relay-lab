#!/usr/bin/env node
/**
 * Stop フック — ドキュメントの陳腐化を防ぐ。
 *
 * 回路モデル / シミュレーションエンジンに変更が入っているのに design.md が
 * 未更新のまま応答を終えようとした場合、終了をブロックして差し戻す。
 *
 * 判定は「HEAD からの未コミット差分」で行う。したがってソースとドキュメントを
 * 同じコミットにまとめた時点で解除される。
 *
 * 注意: 初回コミット前は design.md 自身も未追跡ファイルとして差分に現れるため、
 * このフックは実質的に無効。リポジトリに最初のコミットを打つと有効になる。
 */

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

/** 変更されたら design.md の更新が必要なパス */
const WATCHED = /^src\/circuit\/(types|definitions|engine)\//;

/** 更新対象のドキュメント */
const DOC = "design.md";

/** このスクリプトの位置からプロジェクトルートを解決する（cwd や環境変数に依存しない） */
const projectDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const readStdin = () =>
  new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    // stdin が繋がっていない環境でも固まらないようにする
    setTimeout(() => resolve(data), 2000).unref?.();
  });

let input = {};
try {
  input = JSON.parse((await readStdin()) || "{}");
} catch {
  input = {};
}

// このフックが原因で継続中の場合は再発火させない（無限ループ防止）
if (input.stop_hook_active) process.exit(0);

let changed;
try {
  // -uall が必須。既定では未追跡ディレクトリが "?? src/" の 1 行に畳まれ、
  // 配下の src/circuit/types/... が WATCHED に一致しなくなる。
  const out = execFileSync("git", ["status", "--porcelain", "-uall"], {
    cwd: projectDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  changed = out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      // "XY path" / リネームは "R  old -> new"
      const p = line.slice(3).trim();
      const arrow = p.lastIndexOf(" -> ");
      return (arrow === -1 ? p : p.slice(arrow + 4)).replace(/^"|"$/g, "");
    });
} catch {
  // git 管理外・git 未インストールなら何もしない
  process.exit(0);
}

const touchedSource = changed.filter((p) => WATCHED.test(p));
const touchedDoc = changed.includes(DOC);

if (touchedSource.length > 0 && !touchedDoc) {
  console.error(
    [
      `${DOC} が未更新のまま、回路モデル / エンジンに変更が入っています:`,
      ...touchedSource.map((p) => `  - ${p}`),
      "",
      `CLAUDE.md の「ドキュメント更新トリガー」に従って ${DOC} の該当節を更新してから終了してください。`,
      "  型定義の変更      → design.md §3",
      "  部品定義の追加変更 → design.md §4（端子データ表・確度表）",
      "  エンジン判定の変更 → design.md §5",
      "",
      `更新が不要な変更（整形・コメント修正など）である場合は、その理由を述べてから終了してください。`,
    ].join("\n"),
  );
  process.exit(2); // Stop フックの exit 2 = 終了をブロックし、stderr を Claude へ差し戻す
}

process.exit(0);
