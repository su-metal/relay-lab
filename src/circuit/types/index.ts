/** 回路モデルの型の再エクスポート。利用側は `@/circuit/types` から取る */

export type {
  TerminalDefinition,
  TerminalRole,
  TerminalSide,
} from "./terminal";

export type {
  AnalogCurve,
  AnalogInputChannel,
  AnalogTrigger,
  AnalogOutputChannel,
  CoilPolarity,
  ComponentCategory,
  ComponentDefinition,
  ComponentDefinitionRegistry,
  CommunicationBinding,
  CommunicationDefinition,
  CommunicationPort,
  DeviceOperation,
  DimmerSettings,
  DimmingInput,
  ElectricalDefinition,
  FadeSpec,
  RelayAnalogOutputChannel,
  RelayContact,
  RelayDefinition,
  TimerDelay,
} from "./component";

export type { CircuitConnection, TerminalRef } from "./connection";
export {
  terminalKey,
  operationKey,
  contactKey,
  analogInputKey,
  fadeKey,
  terminalRefKey,
} from "./connection";

export type {
  CircuitComponentInstance,
  CircuitDocument,
  ComponentSize,
  LampColor,
} from "./circuit";
export {
  DEFAULT_LAMP_COLOR,
  LAMP_COLORS,
  componentSizeOf,
  isLampColor,
  normalizeComponentSize,
} from "./circuit";

export { EMPTY_ANALOG_RESULT } from "./simulation";

export type {
  AnalogResult,
  AnalogSignal,
  DimmingLevel,
  FadeState,
  NetState,
  SimulationInput,
  SimulationResult,
  SimulationStatus,
  TimerState,
  Warning,
  WarningCode,
  WarningSeverity,
} from "./simulation";
