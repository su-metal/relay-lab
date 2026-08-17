/**
 * エンジンの公開インターフェース。UI 層からはここだけを import する。
 *
 * `simulate()` 以外を露出しているのは、Step 4 の配線色（§5.6）や
 * Step 5 のプロパティパネルがネット状態を直接読む必要があるため。
 */

export { simulate } from "./simulate";
export { inspectWiring } from "./wiring";
export {
  buildNets,
  computeNetStates,
  conductingPairs,
  stateAt,
} from "./graph";
export type { NetAssignment, NetLookup, OpenContacts } from "./graph";
export { detectSelfInterruptingCoils } from "./chatter";
export {
  atPlus,
  atZero,
  isShorted,
  polarityAcross,
  reachesPlus,
  reachesZero,
  shortedSupplies,
  spansSupply,
} from "./potential";
export type { Polarity } from "./potential";
export { closedContactPairs, evaluateCoil } from "./relay";
export type { CoilEvaluation, TerminalPair } from "./relay";
export {
  advanceTimer,
  coilEnergized,
  elapsedMs,
  initialTimerState,
  presetMsOf,
  timerNextEventAtMs,
  timerOutputOn,
} from "./timer";
export { collectDiodeEdges, inspectDiodes, spreadThroughDiodes } from "./diode";
export type {
  DiodeBias,
  DiodeEdge,
  DiodeInspection,
  FlybackOrientation,
} from "./diode";
export {
  describeComponent,
  detectDiodeOrientation,
  detectPowerShortCircuits,
  detectUnconnectedTerminals,
  statusWarnings,
} from "./validation";
