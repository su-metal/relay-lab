/** 回路モデルの型の再エクスポート。利用側は `@/circuit/types` から取る */

export type {
  TerminalDefinition,
  TerminalRole,
  TerminalSide,
} from "./terminal";

export type {
  CoilPolarity,
  ComponentCategory,
  ComponentDefinition,
  ComponentDefinitionRegistry,
  ElectricalDefinition,
  RelayContact,
  RelayDefinition,
} from "./component";

export type { CircuitConnection, TerminalRef } from "./connection";
export { terminalKey, terminalRefKey } from "./connection";

export type { CircuitComponentInstance, CircuitDocument } from "./circuit";

export type {
  NetState,
  SimulationInput,
  SimulationResult,
  SimulationStatus,
  Warning,
  WarningCode,
  WarningSeverity,
} from "./simulation";
