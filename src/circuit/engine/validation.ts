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

import { inspectDiodes } from "./diode";
import type { NetLookup } from "./graph";
import { shortedSupplies } from "./potential";

/**
 * 警告文に使う部品の呼び名。
 * ユーザーが付けたラベル（"RY1"）があればそれを、無ければ型番を使う。
 */
export const describeComponent = (
  instance: CircuitComponentInstance,
  definition: ComponentDefinition,
): string => instance.label ?? definition.model;

/** インスタンス ID から呼び名を引く。見つからなければ ID をそのまま返す */
const nameResolver = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
): ((componentId: string) => string) => {
  const names = new Map<string, string>();
  for (const instance of document.components) {
    const definition = definitions.get(instance.definitionId);
    if (!definition) continue;
    names.set(instance.id, describeComponent(instance, definition));
  }
  return (componentId) => names.get(componentId) ?? componentId;
};

/**
 * 電源短絡。**同じ 1 台の電源**の + 側と 0V 側が同じネットに乗っている状態。
 *
 * 負荷を union しない設計（design.md §5.2）のおかげで、
 * これは「配線ミスで電源が直結された」ことと厳密に一致する。
 *
 * ネット ID の一致ではなく `NetState` の到達集合で見るのは、順方向の
 * ダイオードを経由した短絡（§5.4）を取りこぼさないため。ダイオードは
 * union されないので + 側と 0V 側は別ネットのままだが、電位は伝わっている。
 *
 * **「1 台の」が要点。** PS1 の + と PS2 の 0V が同じネットに乗るのは短絡では
 * ない（基準が繋がっていないので電流が流れない）。直列接続した 2 台の電源も
 * 同じ理由で短絡にならず、正しく通る（design.md §5.3）。
 */
export const detectPowerShortCircuits = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
  lookup: NetLookup,
): Warning[] => {
  const warnings: Warning[] = [];

  for (const instance of document.components) {
    const definition = definitions.get(instance.definitionId);
    if (!definition) continue;
    const { electrical } = definition;
    if (electrical.kind !== "power") continue;

    const plusNet = lookup.netOf.get(
      terminalKey(instance.id, electrical.positiveTerminal),
    );
    if (plusNet === undefined) continue;
    // 自分の 0V が自分の + と同じネットに乗っているか
    if (!shortedSupplies(lookup.netState.get(plusNet)).includes(instance.id)) {
      continue;
    }

    warnings.push({
      code: "power-short-circuit",
      severity: "error",
      message: `${describeComponent(instance, definition)} の + 側と 0V 側が導通しています（電源短絡）。`,
      componentId: instance.id,
    });
  }

  return warnings;
};

/**
 * ダイオードの向きの誤り（design.md §5.4）。
 *
 * 2 通りを検出する。
 *
 * 1. **コイルと並列のダイオードが逆向き** —— 逆起電力吸収（還流）ダイオードは
 *    カソードをコイルの + 側へ向ける。逆に挿すと通電中ずっと順方向になり、
 *    コイルと並列の短絡経路になる。**通電しているかに関係なく配線の誤りなので、
 *    接点が開いていて今は電流が流れていなくても警告する。**
 * 2. **負荷を挟まずに + と 0V をまたぐ順方向のダイオード** ——
 *    電源直結と同じで、実機ではダイオードに電流が集中して焼損する。
 *
 * 逆向きに入っていて単に電流を遮断しているだけのダイオードは警告しない。
 * 逆流防止として意図的に入れる配線と区別できないため。
 */
export const detectDiodeOrientation = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
  lookup: NetLookup,
): Warning[] => {
  const warnings: Warning[] = [];
  const nameOf = nameResolver(document, definitions);

  for (const diode of inspectDiodes(document, definitions, lookup)) {
    const name = nameOf(diode.componentId);

    if (diode.flyback?.orientation === "reversed") {
      const relay = nameOf(diode.flyback.relayId);
      warnings.push({
        code: "diode-reversed",
        severity: "error",
        message: `${name} の向きが逆です。逆起電力を吸収するには カソード（K）を ${relay} のコイルの + 側へ向けてください。このままではコイルに通電した瞬間に順方向の短絡経路になり、${relay} は励磁せずダイオードが焼損します。`,
        componentId: diode.componentId,
      });
      continue;
    }

    if (diode.shorting) {
      warnings.push({
        code: "diode-reversed",
        severity: "error",
        message: `${name} が順方向のまま + 側と 0V 側をまたいでいます。間に負荷が無いためダイオードが焼損します（向きを確認してください）。`,
        componentId: diode.componentId,
      });
    }
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
