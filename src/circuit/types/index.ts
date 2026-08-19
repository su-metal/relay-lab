/** 回路モデルの型の再エクスポート。利用側は `@/circuit/types` から取る */

export type {
  TerminalDefinition,
  TerminalRole,
  TerminalSide,
} from "./terminal";

export type {
  AnalogCurve,
  CoilPolarity,
  ComponentCategory,
  ComponentDefinition,
  ComponentDefinitionRegistry,
  DimmingInput,
  ElectricalDefinition,
  RelayContact,
  RelayDefinition,
  TimerDelay,
} from "./component";

export type { CircuitConnection, TerminalRef } from "./connection";
export { terminalKey, terminalRefKey } from "./connection";

export type {
  CircuitComponentInstance,
  CircuitDocument,
  LampColor,
} from "./circuit";
export { DEFAULT_LAMP_COLOR, LAMP_COLORS, isLampColor } from "./circuit";

export { EMPTY_ANALOG_RESULT } from "./simulation";

export type {
  AnalogResult,
  AnalogSignal,
  DimmingLevel,
  NetState,
  SimulationInput,
  SimulationResult,
  SimulationStatus,
  TimerState,
  Warning,
  WarningCode,
  WarningSeverity,
} from "./simulation";
