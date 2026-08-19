/**
 * エンジンの公開インターフェース。UI 層からはここだけを import する。
 *
 * `simulate()` 以外を露出しているのは、Step 4 の配線色（§5.6）や
 * Step 5 のプロパティパネルがネット状態を直接読む必要があるため。
 */

export { simulate } from "./simulate";
export { inspectWiring } from "./wiring";
export { previewPaths } from "./preview";
export type { PathPreview, PreviewBlocker } from "./preview";
export {
  AT_REST,
  NONE_ENERGIZED,
  UnionFind,
  buildNets,
  computeNetStates,
  conductingPairs,
  openPairs,
  solveWithoutRelays,
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
export {
  closedContactPairs,
  evaluateCoil,
  openContactPairs,
} from "./relay";
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
export {
  analogPercent,
  analogSignalNets,
  channelVoltsOf,
  effectiveCurve,
  shapePercent,
  outputVoltsOf,
  resolveAnalog,
} from "./analog";
export { collectDiodeEdges, inspectDiodes, spreadThroughDiodes } from "./diode";
export type {
  DiodeBias,
  DiodeEdge,
  DiodeInspection,
  FlybackOrientation,
} from "./diode";
export {
  describeComponent,
  detectAnalogReferenceMismatch,
  detectDiodeOrientation,
  detectPowerShortCircuits,
  detectUnconnectedTerminals,
  statusWarnings,
} from "./validation";
