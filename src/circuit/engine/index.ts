/**
 * エンジンの公開インターフェース。UI 層からはここだけを import する。
 *
 * `simulate()` 以外を露出しているのは、Step 4 の配線色（§5.6）や
 * Step 5 のプロパティパネルがネット状態を直接読む必要があるため。
 */

export { simulate } from "./simulate";
export { buildNets, computeNetStates, stateAt } from "./graph";
export type { NetAssignment, NetLookup } from "./graph";
export { atPlus, atZero, polarityAcross } from "./potential";
export type { Polarity } from "./potential";
export { closedContactPairs, evaluateCoil } from "./relay";
export type { CoilEvaluation, TerminalPair } from "./relay";
export {
  describeComponent,
  detectPowerShortCircuits,
  detectUnconnectedTerminals,
  statusWarnings,
} from "./validation";
