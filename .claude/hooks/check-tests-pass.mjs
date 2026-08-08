#!/usr/bin/env node
/**
 * Stop フック — テストが落ちたまま応答を終えられないようにする検証ゲート。
 *
 * `requirements.md` Step 0 の要求。エンジンは純粋関数で Vitest から直接叩けるため、
 * 「実装したら npm test が緑」を機械的に強制する。
 *
 * 注意: npm 経由では起動しない。Windows では execFileSync("npm", ...) が npm.cmd を
 * 解決できず失敗するため、vitest の実体を process.execPath で直接叩く。
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/** 失敗時に差し戻す出力の行数上限 */
const MAX_OUTPUT_LINES = 60;

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

// npm install 前はブロックしない
const vitestBin = path.join(projectDir, "node_modules", "vitest", "vitest.mjs");
if (!existsSync(vitestBin)) process.exit(0);

const tail = (text) => {
  const lines = String(text ?? "")
    .split("\n")
    .filter((line) => line.trim() !== "");
  return lines.length > MAX_OUTPUT_LINES
    ? lines.slice(-MAX_OUTPUT_LINES).join("\n")
    : lines.join("\n");
};

try {
  execFileSync(process.execPath, [vitestBin, "run"], {
    cwd: projectDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CI: "true", NO_COLOR: "1" },
  });
} catch (error) {
  const output = tail(`${error.stdout ?? ""}\n${error.stderr ?? ""}`);
  console.error(
    [
      "npm test が失敗したまま応答を終了しようとしています。",
      "",
      output || `vitest を起動できませんでした: ${error.message}`,
      "",
      "テストを緑にしてから終了してください。成功を主張せず、テスト出力を示すこと。",
    ].join("\n"),
  );
  process.exit(2); // Stop フックの exit 2 = 終了をブロックし、stderr を Claude へ差し戻す
}

process.exit(0);
