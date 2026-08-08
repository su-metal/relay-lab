/**
 * 警告の検出（design.md §5.7）。
 *
 * `message` は UI にそのまま出せる日本語で組み立てる。
 * 深刻度は `WarningCode` とは別に持つ — 発振は配線として正しくても
 * 必ず起きる挙動（ブザー回路）であり、エラーとして出すべきではない（design.md §5.5）。
 */

import type {
  CircuitComponentInstance,
  CircuitDocument,
  ComponentDefinition,
  ComponentDefinitionRegistry,
  SimulationStatus,
  Warning,
} from "@/circuit/types";
import { terminalKey, terminalRefKey } from "@/circuit/types";
import { MAX_ITERATIONS } from "@/lib/app-info";

/**
 * 警告文に使う部品の呼び名。
 * ユーザーが付けたラベル（"RY1"）があればそれを、無ければ型番を使う。
 */
export const describeComponent = (
  instance: CircuitComponentInstance,
  definition: ComponentDefinition,
): string => instance.label ?? definition.model;

/**
 * 電源短絡。+ 端子と 0V 端子が同一ネットに落ちている状態。
 *
 * 負荷を union しない設計（design.md §5.2）のおかげで、
 * これは「配線ミスで電源が直結された」ことと厳密に一致する。
 */
export const detectPowerShortCircuits = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
  netOf: ReadonlyMap<string, number>,
): Warning[] => {
  const warnings: Warning[] = [];

  for (const instance of document.components) {
    const definition = definitions.get(instance.definitionId);
    if (!definition) continue;
    const { electrical } = definition;
    if (electrical.kind !== "power") continue;

    const plusNet = netOf.get(
      terminalKey(instance.id, electrical.positiveTerminal),
    );
    const zeroNet = netOf.get(terminalKey(instance.id, electrical.zeroTerminal));
    if (plusNet === undefined || zeroNet === undefined) continue;
    if (plusNet !== zeroNet) continue;

    warnings.push({
      code: "power-short-circuit",
      severity: "error",
      message: `${describeComponent(instance, definition)} の + 側と 0V 側が同じネットに繋がっています（電源短絡）。`,
      componentId: instance.id,
    });
  }

  return warnings;
};

/**
 * 未接続端子。どの `CircuitConnection` にも現れない端子。
 *
 * MY4N のように使わない接点が多い部品では大量に出るため severity は info。
 * UI では既定で折りたたむ想定（Step 6）。
 */
export const detectUnconnectedTerminals = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
): Warning[] => {
  const wired = new Set<string>();
  for (const connection of document.connections) {
    wired.add(terminalRefKey(connection.from));
    wired.add(terminalRefKey(connection.to));
  }

  const warnings: Warning[] = [];
  for (const instance of document.components) {
    const definition = definitions.get(instance.definitionId);
    if (!definition) continue;
    for (const terminal of definition.terminals) {
      if (wired.has(terminalKey(instance.id, terminal.id))) continue;
      warnings.push({
        code: "unconnected-terminal",
        severity: "info",
        message: `${describeComponent(instance, definition)} の端子 ${terminal.label} は未接続です。`,
        componentId: instance.id,
        terminalId: terminal.id,
      });
    }
  }
  return warnings;
};

/** 収束結果そのものに対する警告。`stable` のときは何も出さない */
export const statusWarnings = (status: SimulationStatus): Warning[] => {
  switch (status) {
    case "stable":
      return [];
    case "oscillating":
      return [
        {
          code: "oscillating",
          severity: "info",
          message:
            "この回路は発振します（ブザー動作）。接点が開閉を繰り返すため状態は安定しません。",
        },
      ];
    case "not-converged":
      return [
        {
          code: "not-converged",
          severity: "error",
          message: `${MAX_ITERATIONS} 回計算しても状態が安定しませんでした。配線を見直してください。`,
        },
      ];
  }
};
