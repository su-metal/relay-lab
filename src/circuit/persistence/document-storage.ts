/**
 * 回路ドキュメントの永続化（design.md §7）。
 *
 * 読み書きの規則はここに閉じ、保存データは常に壊れている可能性があるものとして
 * 検証する。読めない部品・配線は理由を添えて落とす。
 */

import {
  fadeMsOf,
  outputVoltsOf,
  presetMsOf,
  triggerPercentOf,
} from "@/circuit/engine";
import type {
  CircuitComponentInstance,
  CircuitConnection,
  CircuitDocument,
  ComponentDefinition,
  ComponentDefinitionRegistry,
  TerminalRef,
} from "@/circuit/types";
import {
  isLampColor,
  normalizeComponentSize,
  terminalRefKey,
} from "@/circuit/types";

export const STORAGE_KEY = "relay-lab:circuit:v1";

const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 1 };

export type LoadResult =
  | { status: "empty" }
  | { status: "invalid"; reason: string }
  | {
      status: "loaded";
      document: CircuitDocument;
      dropped: readonly string[];
    };

export type DocumentStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isId = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isPoint = (value: unknown): value is { x: number; y: number } =>
  isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);

const invalid = (reason: string): LoadResult => ({ status: "invalid", reason });

const displayName = (label: unknown, id: string): string =>
  typeof label === "string" && label.trim() !== "" ? label.trim() : id;

const readTerminalRef = (value: unknown): TerminalRef | null =>
  isRecord(value) && isId(value.componentId) && isId(value.terminalId)
    ? { componentId: value.componentId, terminalId: value.terminalId }
    : null;

/**
 * 部品の表示寸法を読む。既定寸法未満は安全な最小値へ丸め、既定寸法と同じなら
 * `undefined` に戻す。壊れた値は部品ごと捨てず、既定寸法へフォールバックする。
 */
const readComponentSize = (
  definition: ComponentDefinition,
  value: unknown,
): CircuitComponentInstance["size"] => {
  if (!isRecord(value)) return undefined;
  if (!isFiniteNumber(value.width) || !isFiniteNumber(value.height)) {
    return undefined;
  }
  if (value.width <= 0 || value.height <= 0) return undefined;
  return normalizeComponentSize(definition, {
    width: value.width,
    height: value.height,
  });
};

const readPresetMs = (
  definition: ComponentDefinition,
  value: unknown,
): number | undefined => {
  const { electrical } = definition;
  if (electrical.kind !== "relay" || !electrical.delay) return undefined;
  if (!isFiniteNumber(value)) return undefined;
  return presetMsOf(electrical.delay, value);
};

const readFadeMs = (
  definition: ComponentDefinition,
  value: unknown,
): number | undefined => {
  const { electrical } = definition;
  if (electrical.kind !== "analog-source" || !electrical.fade) return undefined;
  if (!isFiniteNumber(value)) return undefined;
  return fadeMsOf(electrical.fade, value);
};

const readChannelVolts = (
  definition: ComponentDefinition,
  value: unknown,
  legacy: unknown,
): CircuitComponentInstance["channelVolts"] => {
  const { electrical } = definition;
  if (electrical.kind !== "analog-source") return undefined;

  const volts: Record<string, number> = {};
  const first = electrical.channels[0];
  if (first && isFiniteNumber(legacy)) {
    volts[first.id] = outputVoltsOf(electrical, legacy);
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const channel of electrical.channels) {
      const raw = (value as Record<string, unknown>)[channel.id];
      if (isFiniteNumber(raw)) volts[channel.id] = outputVoltsOf(electrical, raw);
    }
  }

  return Object.keys(volts).length === 0 ? undefined : volts;
};

const readPercent = (value: unknown): number | undefined =>
  isFiniteNumber(value) ? Math.min(Math.max(value, 0), 100) : undefined;

const readTriggerPercents = (
  definition: ComponentDefinition,
  value: unknown,
): CircuitComponentInstance["triggerPercents"] => {
  const { electrical } = definition;
  if (electrical.kind !== "relay") return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;

  const percents: Record<string, number> = {};
  const entry = value as Record<string, unknown>;

  for (const contact of electrical.relay.contacts) {
    if (!contact.trigger) continue;
    const raw = entry[contact.id];
    if (!isFiniteNumber(raw)) continue;
    percents[contact.id] = triggerPercentOf(contact.trigger, raw);
  }

  return Object.keys(percents).length === 0 ? undefined : percents;
};

const readDimmerSettings = (
  definition: ComponentDefinition,
  value: unknown,
): CircuitComponentInstance["dimmerSettings"] => {
  const { electrical } = definition;
  const applies =
    electrical.kind === "dimmer" ||
    (electrical.kind === "lamp" && electrical.dimming !== undefined);
  if (!applies) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;

  const entry = value as Record<string, unknown>;
  const shape = entry.curveShape;
  const settings: CircuitComponentInstance["dimmerSettings"] = {
    ...(typeof entry.inverted === "boolean" ? { inverted: entry.inverted } : {}),
    ...(typeof entry.direct === "boolean" ? { direct: entry.direct } : {}),
    ...(readPercent(entry.maxPercent) !== undefined
      ? { maxPercent: readPercent(entry.maxPercent) }
      : {}),
    ...(readPercent(entry.minPercent) !== undefined
      ? { minPercent: readPercent(entry.minPercent) }
      : {}),
    ...(shape === "linear" || shape === "square" ? { curveShape: shape } : {}),
  };

  return Object.keys(settings).length === 0 ? undefined : settings;
};

const readLampColor = (
  definition: ComponentDefinition,
  value: unknown,
): CircuitComponentInstance["lampColor"] => {
  if (definition.electrical.kind !== "lamp") return undefined;
  return isLampColor(value) ? value : undefined;
};

const readViewport = (value: unknown): CircuitDocument["viewport"] => {
  if (!isRecord(value)) return DEFAULT_VIEWPORT;
  const { x, y, zoom } = value;
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return DEFAULT_VIEWPORT;
  if (!isFiniteNumber(zoom) || zoom <= 0) return DEFAULT_VIEWPORT;
  return { x, y, zoom };
};

export const serializeDocument = (document: CircuitDocument): string =>
  JSON.stringify(document);

export const parseDocument = (
  raw: string | null,
  registry: ComponentDefinitionRegistry,
): LoadResult => {
  if (raw === null || raw.trim() === "") return { status: "empty" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return invalid("保存データを JSON として読み取れませんでした。");
  }

  if (!isRecord(parsed)) {
    return invalid("保存データの形式が想定と異なります。");
  }
  if (parsed.version !== 1) {
    return invalid(
      `対応していない保存バージョンです（version: ${String(parsed.version)}）。`,
    );
  }
  if (!Array.isArray(parsed.components) || !Array.isArray(parsed.connections)) {
    return invalid("保存データに部品または配線の一覧がありません。");
  }

  const dropped: string[] = [];
  const components: CircuitComponentInstance[] = [];
  const terminalsOf = new Map<string, Set<string>>();

  for (const entry of parsed.components) {
    if (!isRecord(entry) || !isId(entry.id)) {
      dropped.push("部品 1 件を読み込めませんでした（ID がありません）。");
      continue;
    }
    const name = displayName(entry.label, entry.id);

    if (terminalsOf.has(entry.id)) {
      dropped.push(`部品 ${name} を読み込めませんでした（ID が重複しています）。`);
      continue;
    }
    if (!isId(entry.definitionId)) {
      dropped.push(`部品 ${name} を読み込めませんでした（部品定義がありません）。`);
      continue;
    }
    const definition = registry.get(entry.definitionId);
    if (!definition) {
      dropped.push(
        `部品 ${name} を読み込めませんでした（未知の部品定義: ${entry.definitionId}）。`,
      );
      continue;
    }
    if (!isPoint(entry.position)) {
      dropped.push(`部品 ${name} を読み込めませんでした（座標が不正です）。`);
      continue;
    }

    components.push({
      id: entry.id,
      definitionId: entry.definitionId,
      label:
        typeof entry.label === "string" && entry.label.trim() !== ""
          ? entry.label
          : undefined,
      position: { x: entry.position.x, y: entry.position.y },
      size: readComponentSize(definition, entry.size),
      flipped: entry.flipped === true ? true : undefined,
      presetMs: readPresetMs(definition, entry.presetMs),
      lampColor: readLampColor(definition, entry.lampColor),
      channelVolts: readChannelVolts(
        definition,
        entry.channelVolts,
        entry.outputVolts,
      ),
      fadeMs: readFadeMs(definition, entry.fadeMs),
      dimmerSettings: readDimmerSettings(definition, entry.dimmerSettings),
      triggerPercents: readTriggerPercents(definition, entry.triggerPercents),
    });
    terminalsOf.set(
      entry.id,
      new Set(definition.terminals.map((terminal) => terminal.id)),
    );
  }

  const connections: CircuitConnection[] = [];
  const seenConnectionIds = new Set<string>();
  const seenPairs = new Set<string>();

  const exists = (ref: TerminalRef): boolean =>
    terminalsOf.get(ref.componentId)?.has(ref.terminalId) ?? false;

  for (const entry of parsed.connections) {
    if (!isRecord(entry) || !isId(entry.id)) {
      dropped.push("配線 1 本を読み込めませんでした（ID がありません）。");
      continue;
    }
    const from = readTerminalRef(entry.from);
    const to = readTerminalRef(entry.to);
    if (!from || !to) {
      dropped.push(`配線 ${entry.id} を読み込めませんでした（端子の指定が不正です）。`);
      continue;
    }
    if (!exists(from) || !exists(to)) {
      dropped.push(
        `配線 ${entry.id} を読み込めませんでした（接続先の端子が存在しません）。`,
      );
      continue;
    }
    if (seenConnectionIds.has(entry.id)) {
      dropped.push(`配線 ${entry.id} を読み込めませんでした（ID が重複しています）。`);
      continue;
    }
    const pair = [terminalRefKey(from), terminalRefKey(to)].sort().join("|");
    if (seenPairs.has(pair)) {
      dropped.push(`配線 ${entry.id} を読み込めませんでした（同じ端子間の重複配線です）。`);
      continue;
    }

    seenConnectionIds.add(entry.id);
    seenPairs.add(pair);
    connections.push({ id: entry.id, from, to });
  }

  return {
    status: "loaded",
    document: {
      version: 1,
      components,
      connections,
      viewport: readViewport(parsed.viewport),
    },
    dropped,
  };
};

export const getDocumentStorage = (): DocumentStorage | null => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export const readStoredDocument = (
  storage: DocumentStorage,
  registry: ComponentDefinitionRegistry,
): LoadResult => {
  try {
    return parseDocument(storage.getItem(STORAGE_KEY), registry);
  } catch {
    return invalid("保存データを読み出せませんでした。");
  }
};

export const writeStoredDocument = (
  storage: DocumentStorage,
  document: CircuitDocument,
): boolean => {
  try {
    storage.setItem(STORAGE_KEY, serializeDocument(document));
    return true;
  } catch {
    return false;
  }
};

export const clearStoredDocument = (storage: DocumentStorage): void => {
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // 消せなくても操作を止める理由にはならない
  }
};
