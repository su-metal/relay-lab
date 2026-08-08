/**
 * 収束ループ（design.md §5.5）。エンジンのエントリポイント。
 *
 * リレー回路は「接点の状態がコイルを決め、コイルが接点を決める」相互依存なので、
 * 一度グラフを解くだけでは答えが出ない。励磁状態を仮に置いてグラフを解き直す、
 * を状態が変わらなくなるまで繰り返す（不動点反復）。
 *
 * このファイルは React / Zustand / React Flow を import しない（CLAUDE.md 設計原則 1）。
 */

import type {
  CircuitDocument,
  ComponentDefinitionRegistry,
  NetState,
  SimulationInput,
  SimulationResult,
  SimulationStatus,
  Warning,
} from "@/circuit/types";
import { MAX_ITERATIONS } from "@/lib/app-info";

import {
  buildNets,
  computeNetStates,
  stateAt,
  type NetAssignment,
  type NetLookup,
} from "./graph";
import { polarityAcross } from "./potential";
import { evaluateCoil } from "./relay";
import {
  describeComponent,
  detectPowerShortCircuits,
  detectUnconnectedTerminals,
  statusWarnings,
} from "./validation";

/** 励磁状態の集合を比較用の文字列にする。発振検出の履歴キーにも使う */
const signature = (relays: ReadonlySet<string>): string =>
  [...relays].sort().join("|");

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
};

type RelayEvaluation = {
  energized: Set<string>;
  warnings: Warning[];
};

/** 全リレーのコイルを一斉に評価する。接点の状態は評価中に変えない（同時性の担保） */
const evaluateRelays = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
  lookup: NetLookup,
): RelayEvaluation => {
  const energized = new Set<string>();
  const warnings: Warning[] = [];

  for (const instance of document.components) {
    const definition = definitions.get(instance.definitionId);
    if (!definition) continue;
    const { electrical } = definition;
    if (electrical.kind !== "relay") continue;

    const { coil } = electrical.relay;
    const evaluation = evaluateCoil(
      coil,
      stateAt(lookup, instance.id, coil.positiveTerminal),
      stateAt(lookup, instance.id, coil.negativeTerminal),
    );

    if (evaluation.energized) energized.add(instance.id);

    if (evaluation.reversed) {
      const name = describeComponent(instance, definition);
      warnings.push({
        code: "coil-polarity-reversed",
        severity: coil.polarity === "strict" ? "error" : "warning",
        message:
          coil.polarity === "strict"
            ? `${name} のコイルの極性が逆です。内蔵ダイオードが順方向になるため励磁しません。`
            : `${name} のコイルの極性が逆です（励磁はしますが表示灯が点灯しません）。`,
        componentId: instance.id,
        terminalId: coil.positiveTerminal,
      });
    }
  }

  return { energized, warnings };
};

/**
 * 点灯しているランプを求める。
 *
 * ランプは負荷なのでグラフ上で union されていない（design.md §5.2）。
 * 「両端が異なる電源ネットに属するか」だけが点灯条件で、極性は問わない。
 */
const collectLitLamps = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
  lookup: NetLookup,
): Set<string> => {
  const lit = new Set<string>();

  for (const instance of document.components) {
    const definition = definitions.get(instance.definitionId);
    if (!definition) continue;
    const { electrical } = definition;
    if (electrical.kind !== "lamp") continue;

    const across = polarityAcross(
      stateAt(lookup, instance.id, electrical.terminalA),
      stateAt(lookup, instance.id, electrical.terminalB),
    );
    if (across !== "none") lit.add(instance.id);
  }

  return lit;
};

/** 1 回の反復で得られた状態のスナップショット */
type Iteration = {
  /** このグラフを組み立てるのに使った励磁状態 */
  energized: ReadonlySet<string>;
  nets: NetAssignment;
  netState: Map<number, NetState>;
  coilWarnings: Warning[];
};

/**
 * 回路を解く。
 *
 * @param input.previousEnergizedRelays 直前の励磁状態。自己保持回路の再現に必須
 */
export const simulate = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
  input: SimulationInput,
): SimulationResult => {
  // 前回の励磁状態から始める。全 OFF から解き直すと、自己保持回路は
  // ボタンを離した瞬間に全 OFF（これも安定解）へ落ちてしまう
  let energized: ReadonlySet<string> = new Set(
    input.previousEnergizedRelays ?? [],
  );
  const history: string[] = [];

  let status: SimulationStatus = "not-converged";
  let iterations = 0;
  let last: Iteration | undefined;

  while (iterations < MAX_ITERATIONS) {
    iterations += 1;

    const nets = buildNets(document, definitions, input, energized);
    const netState = computeNetStates(document, definitions, nets);
    const lookup: NetLookup = { netOf: nets.netOf, netState };
    const relays = evaluateRelays(document, definitions, lookup);

    last = { energized, nets, netState, coilWarnings: relays.warnings };

    if (sameSet(relays.energized, energized)) {
      status = "stable";
      break;
    }

    const key = signature(relays.energized);
    if (history.includes(key)) {
      // 同じ励磁状態が再出現した＝周期に入った。反復上限とは区別する（design.md §5.5）
      status = "oscillating";
      break;
    }
    history.push(key);
    energized = relays.energized;
  }

  // MAX_ITERATIONS が 1 以上である限り last は必ず入る
  if (!last) {
    throw new Error("収束ループが 1 回も実行されませんでした");
  }

  const lookup: NetLookup = { netOf: last.nets.netOf, netState: last.netState };

  const warnings: Warning[] = [
    ...detectPowerShortCircuits(document, definitions, last.nets.netOf),
    ...last.coilWarnings,
    ...statusWarnings(status),
    ...detectUnconnectedTerminals(document, definitions),
  ];

  return {
    energizedRelays: last.energized,
    litLamps: collectLitLamps(document, definitions, lookup),
    netOf: last.nets.netOf,
    netState: last.netState,
    warnings,
    status,
    iterations,
  };
};
