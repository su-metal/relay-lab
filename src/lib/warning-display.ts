/**
 * 警告一覧の表示用整理（design.md §5.7・§8.4）。
 *
 * **判定はしない。** `SimulationResult.warnings` を並べ替えて種別ごとに束ねるだけ。
 * 束ねるのは未接続端子のためで、MY4N を 1 個置いただけで 14 件出るような警告を
 * そのまま縦に並べると、本当に危険な電源短絡が画面外へ押し出される。
 */

import type { Warning, WarningCode, WarningSeverity } from "@/circuit/types";

/** 種別の見出し。本文（`Warning.message`）はエンジンが日本語で持っている */
export const WARNING_CODE_LABELS: Record<WarningCode, string> = {
  "power-short-circuit": "電源短絡",
  "coil-polarity-reversed": "コイル極性",
  "unconnected-terminal": "未接続の端子",
  oscillating: "発振",
  "not-converged": "収束しません",
};

/**
 * 深刻度の表示。**発振は「エラー」ではない**（design.md §5.5）。
 * B 接点による自励発振は配線として正しくても必ず起きる挙動なので、
 * ブザー回路を組んだ人に赤い「エラー」を出してはいけない。
 */
export const SEVERITY_LABELS: Record<WarningSeverity, string> = {
  error: "エラー",
  warning: "警告",
  info: "情報",
};

/** 重い順。同じ深刻度の中では検出順（＝エンジンの並び）を保つ */
const SEVERITY_ORDER: Record<WarningSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

/** 1 グループで最初から見せる件数。残りは「他 N 件」に畳む */
export const VISIBLE_PER_GROUP = 4;

export type WarningGroup = {
  /** グループのキー（種別＋深刻度）。React の key に使う */
  key: string;
  code: WarningCode;
  severity: WarningSeverity;
  label: string;
  warnings: readonly Warning[];
};

/**
 * 種別＋深刻度でまとめ、重い順に並べる。
 *
 * 深刻度も束ねの軸に入れているのは、同じ `coil-polarity-reversed` でも
 * `strict`（error）と `indicator`（warning）で意味がまるで違うから（§5.7）。
 */
export const groupWarnings = (
  warnings: readonly Warning[],
): WarningGroup[] => {
  const groups = new Map<string, WarningGroup & { warnings: Warning[] }>();

  for (const warning of warnings) {
    const key = `${warning.code}:${warning.severity}`;
    const group = groups.get(key);
    if (group) {
      group.warnings.push(warning);
      continue;
    }
    groups.set(key, {
      key,
      code: warning.code,
      severity: warning.severity,
      label: WARNING_CODE_LABELS[warning.code],
      warnings: [warning],
    });
  }

  return [...groups.values()].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
};

/** 最も重い深刻度。操作バーのバッジに出す（警告が 1 件も無ければ undefined） */
export const highestSeverity = (
  warnings: readonly Warning[],
): WarningSeverity | undefined => {
  let highest: WarningSeverity | undefined;
  for (const warning of warnings) {
    if (!highest || SEVERITY_ORDER[warning.severity] < SEVERITY_ORDER[highest]) {
      highest = warning.severity;
    }
  }
  return highest;
};
