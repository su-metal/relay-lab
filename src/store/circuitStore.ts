"use client";

/**
 * 回路ドキュメントのストア（design.md §7）。
 *
 * 保持するのは **保存対象である `CircuitDocument` と選択状態、そして履歴だけ。**
 * シミュレーションの実行時状態は `simulationStore` に分ける。
 * 混ぜると保存 JSON に実行時状態が混入し、Undo 履歴も汚れる。
 *
 * Undo / Redo は `{ past, present, future }`（present = `document`）。
 * **スナップショットを取るのは 部品追加 / 削除 / 配線確定 / ドラッグ・リサイズ完了。**
 * ドラッグ・リサイズ中の更新とラベル編集は何十回も発火するので、その都度は積まない。
 */

import { create } from "zustand";

import {
  connectionFromReactFlow,
  hasTerminalPair,
  isSameTerminalPair,
} from "@/circuit/adapter/reactflow";
import { getComponentDefinition } from "@/circuit/definitions";
import {
  fadeMsOf,
  outputVoltsOf,
  presetMsOf,
  triggerPercentOf,
} from "@/circuit/engine";
import type {
  DimmerSettings,
  CircuitDocument,
  ComponentCategory,
  ComponentDefinition,
  LampColor,
} from "@/circuit/types";
import {
  DEFAULT_LAMP_COLOR,
  isLampColor,
  normalizeComponentSize,
} from "@/circuit/types";
import type { Connection } from "@xyflow/react";

type Point = { x: number; y: number };
type Viewport = { x: number; y: number; zoom: number };
type ResizeRect = Point & { width: number; height: number };

/**
 * 履歴の上限。1 手あたりドキュメント 1 枚を丸ごと持つので、
 * 部品数 × 手数だけメモリを食う。実務の作業単位として 50 手戻れれば足りる。
 */
const HISTORY_LIMIT = 50;

const emptyDocument = (): CircuitDocument => ({
  version: 1,
  components: [],
  connections: [],
  viewport: { x: 0, y: 0, zoom: 1 },
});

let idCounter = 0;
const createId = (prefix: string) =>
  `${prefix}-${(++idCounter).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * 自動で振るラベルの接頭辞。実務の図面でよく使う記号に合わせる。
 * ユーザーが後から変更できる前提の初期値（`CircuitDocument.components[].label`）。
 */
const LABEL_PREFIX: Record<ComponentCategory, string> = {
  power: "PS",
  switch: "S",
  relay: "RY",
  lamp: "L",
  diode: "D",
  terminal: "TB",
  timer: "T",
  dimmer: "DIM",
};

/** 同じ接頭辞の最大番号 + 1 を返す（RY1 が居れば RY2） */
const nextLabel = (
  document: CircuitDocument,
  category: ComponentCategory,
): string => {
  const prefix = LABEL_PREFIX[category];
  const pattern = new RegExp(`^${prefix}(\\d+)$`);
  let max = 0;
  for (const component of document.components) {
    const matched = component.label?.match(pattern);
    if (matched) max = Math.max(max, Number(matched[1]));
  }
  return `${prefix}${max + 1}`;
};

export type CircuitStore = {
  document: CircuitDocument;
  past: readonly CircuitDocument[];
  future: readonly CircuitDocument[];

  selectedComponentIds: readonly string[];
  selectedConnectionIds: readonly string[];

  addComponent: (definition: ComponentDefinition, position: Point) => string;
  moveComponent: (componentId: string, position: Point) => void;
  /**
   * NodeResizer から来る左上座標と寸法を反映する。
   * 寸法は定義の既定値より小さくならないようストア側でも丸める。
   */
  resizeComponent: (componentId: string, rect: ResizeRect) => void;
  applyLayout: (positions: ReadonlyMap<string, Point>) => void;

  removeElements: (
    componentIds: readonly string[],
    connectionIds: readonly string[],
  ) => void;

  setComponentLabel: (componentId: string, label: string) => void;
  flipComponents: (componentIds: readonly string[]) => void;
  setComponentPreset: (componentId: string, presetMs: number) => void;
  setComponentChannelVolts: (
    componentId: string,
    channelId: string,
    volts: number,
  ) => void;
  setComponentFadeMs: (componentId: string, fadeMs: number) => void;
  setComponentDimmerSettings: (
    componentId: string,
    patch: Partial<DimmerSettings>,
  ) => void;
  setComponentTriggerPercent: (
    componentId: string,
    contactId: string,
    percent: number,
  ) => void;
  setComponentLampColor: (componentId: string, color: LampColor) => void;
  replaceComponentDefinition: (
    componentId: string,
    definition: ComponentDefinition,
  ) => void;

  addConnection: (params: Connection) => void;
  reconnectConnection: (connectionId: string, params: Connection) => void;

  setComponentSelected: (componentId: string, selected: boolean) => void;
  setConnectionSelected: (connectionId: string, selected: boolean) => void;
  setSelectedConnections: (connectionIds: readonly string[]) => void;
  setSelectedComponents: (componentIds: readonly string[]) => void;
  selectOnlyComponent: (componentId: string) => void;
  clearSelection: () => void;
  removeSelected: () => void;

  setViewport: (viewport: Viewport) => void;

  beginComponentDrag: () => void;
  endComponentDrag: () => void;
  /** リサイズ中は毎フレーム寸法が変わるため、履歴は開始/終了の対で 1 手にまとめる */
  beginComponentResize: () => void;
  endComponentResize: () => void;

  undo: () => void;
  redo: () => void;
  replaceDocument: (document: CircuitDocument) => void;
};

const withSelected = (
  ids: readonly string[],
  id: string,
  selected: boolean,
): readonly string[] => {
  const has = ids.includes(id);
  if (selected === has) return ids;
  return selected ? [...ids, id] : ids.filter((current) => current !== id);
};

const sameIds = (a: readonly string[], b: readonly string[]): boolean => {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
};

const retained = (
  ids: readonly string[],
  alive: ReadonlySet<string>,
): readonly string[] => {
  const next = ids.filter((id) => alive.has(id));
  return next.length === ids.length ? ids : next;
};

const idsOf = (document: CircuitDocument) => ({
  components: new Set(document.components.map((component) => component.id)),
  connections: new Set(document.connections.map((connection) => connection.id)),
});

const removeFromDocument = (
  document: CircuitDocument,
  componentIds: ReadonlySet<string>,
  connectionIds: ReadonlySet<string>,
): CircuitDocument => ({
  ...document,
  components: document.components.filter(
    (component) => !componentIds.has(component.id),
  ),
  connections: document.connections.filter(
    (connection) =>
      !connectionIds.has(connection.id) &&
      !componentIds.has(connection.from.componentId) &&
      !componentIds.has(connection.to.componentId),
  ),
});

const positionsChanged = (
  before: CircuitDocument,
  after: CircuitDocument,
): boolean =>
  before.components.length !== after.components.length ||
  before.components.some((component, index) => {
    const current = after.components[index];
    return (
      current === undefined ||
      current.id !== component.id ||
      current.position.x !== component.position.x ||
      current.position.y !== component.position.y
    );
  });

/** リサイズは左/上のハンドルで座標も変わるため、位置と寸法をまとめて比較する */
const geometryChanged = (
  before: CircuitDocument,
  after: CircuitDocument,
): boolean =>
  before.components.length !== after.components.length ||
  before.components.some((component, index) => {
    const current = after.components[index];
    return (
      current === undefined ||
      current.id !== component.id ||
      current.position.x !== component.position.x ||
      current.position.y !== component.position.y ||
      current.size?.width !== component.size?.width ||
      current.size?.height !== component.size?.height
    );
  });

let dragSnapshot: CircuitDocument | null = null;
let resizeSnapshot: CircuitDocument | null = null;

export const useCircuitStore = create<CircuitStore>()((set, get) => {
  const commit = (state: CircuitStore, next: CircuitDocument) => ({
    document: next,
    past: [...state.past, state.document].slice(-HISTORY_LIMIT),
    future: [] as readonly CircuitDocument[],
  });

  const travel = (state: CircuitStore, direction: "undo" | "redo") => {
    const target =
      direction === "undo" ? state.past.at(-1) : state.future.at(0);
    if (!target) return {};

    const document = { ...target, viewport: state.document.viewport };
    const alive = idsOf(document);

    return {
      document,
      past:
        direction === "undo" ? state.past.slice(0, -1) : [...state.past, state.document],
      future:
        direction === "undo"
          ? [state.document, ...state.future]
          : state.future.slice(1),
      selectedComponentIds: retained(
        state.selectedComponentIds,
        alive.components,
      ),
      selectedConnectionIds: retained(
        state.selectedConnectionIds,
        alive.connections,
      ),
    };
  };

  return {
    document: emptyDocument(),
    past: [],
    future: [],
    selectedComponentIds: [],
    selectedConnectionIds: [],

    addComponent: (definition, position) => {
      const id = createId("cmp");
      set((state) =>
        commit(state, {
          ...state.document,
          components: [
            ...state.document.components,
            {
              id,
              definitionId: definition.id,
              label: nextLabel(state.document, definition.category),
              position,
            },
          ],
        }),
      );
      return id;
    },

    moveComponent: (componentId, position) =>
      set((state) => ({
        document: {
          ...state.document,
          components: state.document.components.map((component) =>
            component.id === componentId
              ? { ...component, position }
              : component,
          ),
        },
      })),

    resizeComponent: (componentId, rect) => {
      if (
        !Number.isFinite(rect.x) ||
        !Number.isFinite(rect.y) ||
        !Number.isFinite(rect.width) ||
        !Number.isFinite(rect.height)
      ) {
        return;
      }
      set((state) => {
        let changed = false;
        const components = state.document.components.map((component) => {
          if (component.id !== componentId) return component;
          const definition = getComponentDefinition(component.definitionId);
          if (!definition) return component;

          const size = normalizeComponentSize(definition, {
            width: rect.width,
            height: rect.height,
          });
          const nextPosition = { x: rect.x, y: rect.y };
          const sameSize =
            component.size?.width === size?.width &&
            component.size?.height === size?.height;
          const samePosition =
            component.position.x === nextPosition.x &&
            component.position.y === nextPosition.y;
          if (sameSize && samePosition) return component;

          changed = true;
          const { size: _oldSize, ...rest } = component;
          return size
            ? { ...rest, position: nextPosition, size }
            : { ...rest, position: nextPosition };
        });
        return changed
          ? { document: { ...state.document, components } }
          : {};
      });
    },

    applyLayout: (positions) => {
      if (positions.size === 0) return;
      set((state) => {
        let changed = false;
        const components = state.document.components.map((component) => {
          const position = positions.get(component.id);
          if (
            !position ||
            (position.x === component.position.x &&
              position.y === component.position.y)
          ) {
            return component;
          }
          changed = true;
          return { ...component, position };
        });
        if (!changed) return {};
        return commit(state, { ...state.document, components });
      });
    },

    setComponentLabel: (componentId, label) => {
      const next = label.trim() === "" ? undefined : label;
      set((state) => ({
        document: {
          ...state.document,
          components: state.document.components.map((component) =>
            component.id === componentId
              ? { ...component, label: next }
              : component,
          ),
        },
      }));
    },

    setComponentPreset: (componentId, presetMs) => {
      if (!Number.isFinite(presetMs)) return;
      set((state) => {
        let changed = false;
        const components = state.document.components.map((component) => {
          if (component.id !== componentId) return component;
          const electrical = getComponentDefinition(
            component.definitionId,
          )?.electrical;
          if (electrical?.kind !== "relay" || !electrical.delay) return component;

          const next = presetMsOf(electrical.delay, presetMs);
          if (component.presetMs === next) return component;
          changed = true;
          return { ...component, presetMs: next };
        });
        if (!changed) return {};
        return commit(state, { ...state.document, components });
      });
    },

    setComponentChannelVolts: (componentId, channelId, volts) => {
      if (!Number.isFinite(volts)) return;
      set((state) => {
        let changed = false;
        const components = state.document.components.map((component) => {
          if (component.id !== componentId) return component;
          const electrical = getComponentDefinition(
            component.definitionId,
          )?.electrical;
          if (electrical?.kind !== "analog-source") return component;
          if (!electrical.channels.some((c) => c.id === channelId)) return component;

          const next = outputVoltsOf(electrical, volts);
          if (component.channelVolts?.[channelId] === next) return component;
          changed = true;
          return {
            ...component,
            channelVolts: { ...component.channelVolts, [channelId]: next },
          };
        });
        if (!changed) return {};
        return commit(state, { ...state.document, components });
      });
    },

    setComponentFadeMs: (componentId, fadeMs) => {
      if (!Number.isFinite(fadeMs)) return;
      set((state) => {
        let changed = false;
        const components = state.document.components.map((component) => {
          if (component.id !== componentId) return component;
          const electrical = getComponentDefinition(
            component.definitionId,
          )?.electrical;
          if (electrical?.kind !== "analog-source" || !electrical.fade) {
            return component;
          }

          const next = fadeMsOf(electrical.fade, fadeMs);
          if (component.fadeMs === next) return component;
          changed = true;
          return { ...component, fadeMs: next };
        });
        if (!changed) return {};
        return commit(state, { ...state.document, components });
      });
    },

    setComponentTriggerPercent: (componentId, contactId, percent) => {
      if (!Number.isFinite(percent)) return;
      set((state) => {
        let changed = false;
        const components = state.document.components.map((component) => {
          if (component.id !== componentId) return component;
          const electrical = getComponentDefinition(
            component.definitionId,
          )?.electrical;
          if (electrical?.kind !== "relay") return component;
          const contact = electrical.relay.contacts.find(
            (entry) => entry.id === contactId,
          );
          if (!contact?.trigger) return component;

          const next = triggerPercentOf(contact.trigger, percent);
          if (component.triggerPercents?.[contactId] === next) return component;
          changed = true;
          return {
            ...component,
            triggerPercents: { ...component.triggerPercents, [contactId]: next },
          };
        });
        if (!changed) return {};
        return commit(state, { ...state.document, components });
      });
    },

    setComponentDimmerSettings: (componentId, patch) => {
      set((state) => {
        let changed = false;
        const components = state.document.components.map((component) => {
          if (component.id !== componentId) return component;
          const electrical = getComponentDefinition(
            component.definitionId,
          )?.electrical;
          const applies =
            electrical?.kind === "dimmer" ||
            (electrical?.kind === "lamp" && electrical.dimming !== undefined);
          if (!applies) return component;

          const next: DimmerSettings = { ...component.dimmerSettings, ...patch };
          const before: DimmerSettings = component.dimmerSettings ?? {};
          const keys = Object.keys(next) as (keyof DimmerSettings)[];
          const same =
            keys.length === Object.keys(before).length &&
            keys.every((key) => before[key] === next[key]);
          if (same) return component;
          changed = true;
          return { ...component, dimmerSettings: next };
        });
        if (!changed) return {};
        return commit(state, { ...state.document, components });
      });
    },

    setComponentLampColor: (componentId, color) => {
      if (!isLampColor(color)) return;
      set((state) => {
        let changed = false;
        const components = state.document.components.map((component) => {
          if (component.id !== componentId) return component;
          const electrical = getComponentDefinition(
            component.definitionId,
          )?.electrical;
          if (electrical?.kind !== "lamp") return component;

          const next = color === DEFAULT_LAMP_COLOR ? undefined : color;
          if (component.lampColor === next) return component;
          changed = true;
          const { lampColor: _dropped, ...rest } = component;
          return next === undefined ? rest : { ...rest, lampColor: next };
        });
        if (!changed) return {};
        return commit(state, { ...state.document, components });
      });
    },

    flipComponents: (componentIds) => {
      if (componentIds.length === 0) return;
      const targets = new Set(componentIds);
      set((state) => {
        let changed = false;
        const components = state.document.components.map((component) => {
          if (!targets.has(component.id)) return component;
          changed = true;
          const flipped = component.flipped === true;
          return flipped
            ? { ...component, flipped: undefined }
            : { ...component, flipped: true };
        });
        if (!changed) return {};
        return commit(state, { ...state.document, components });
      });
    },

    replaceComponentDefinition: (componentId, definition) => {
      set((state) => {
        const target = state.document.components.find(
          (component) => component.id === componentId,
        );
        if (!target || target.definitionId === definition.id) return {};

        const terminalIds = new Set(
          definition.terminals.map((terminal) => terminal.id),
        );
        const components = state.document.components.map((component) => {
          if (component.id !== componentId) return component;
          const nextSize = component.size
            ? normalizeComponentSize(definition, component.size)
            : undefined;
          const { size: _oldSize, ...rest } = component;
          return nextSize
            ? { ...rest, definitionId: definition.id, size: nextSize }
            : { ...rest, definitionId: definition.id };
        });
        const connections = state.document.connections.filter((connection) => {
          if (
            connection.from.componentId === componentId &&
            !terminalIds.has(connection.from.terminalId)
          ) {
            return false;
          }
          if (
            connection.to.componentId === componentId &&
            !terminalIds.has(connection.to.terminalId)
          ) {
            return false;
          }
          return true;
        });

        const next = { ...state.document, components, connections };
        const alive = idsOf(next);
        return {
          ...commit(state, next),
          selectedConnectionIds: retained(
            state.selectedConnectionIds,
            alive.connections,
          ),
        };
      });
    },

    removeElements: (componentIds, connectionIds) => {
      if (componentIds.length + connectionIds.length === 0) return;
      set((state) => {
        const next = removeFromDocument(
          state.document,
          new Set(componentIds),
          new Set(connectionIds),
        );
        if (
          next.components.length === state.document.components.length &&
          next.connections.length === state.document.connections.length
        ) {
          return {};
        }
        const alive = idsOf(next);
        return {
          ...commit(state, next),
          selectedComponentIds: retained(
            state.selectedComponentIds,
            alive.components,
          ),
          selectedConnectionIds: retained(
            state.selectedConnectionIds,
            alive.connections,
          ),
        };
      });
    },

    addConnection: (params) => {
      const candidate = connectionFromReactFlow(params, createId("wire"));
      if (!candidate) return;
      if (hasTerminalPair(get().document, candidate)) return;
      set((state) =>
        commit(state, {
          ...state.document,
          connections: [...state.document.connections, candidate],
        }),
      );
    },

    reconnectConnection: (connectionId, params) => {
      const candidate = connectionFromReactFlow(params, connectionId);
      if (!candidate) return;

      set((state) => {
        const current = state.document.connections.find(
          (connection) => connection.id === connectionId,
        );
        if (!current) return {};
        if (isSameTerminalPair(current, candidate)) return {};
        if (hasTerminalPair(state.document, candidate)) return {};

        return commit(state, {
          ...state.document,
          connections: state.document.connections.map((connection) =>
            connection.id === connectionId ? candidate : connection,
          ),
        });
      });
    },

    setComponentSelected: (componentId, selected) =>
      set((state) => {
        const next = withSelected(
          state.selectedComponentIds,
          componentId,
          selected,
        );
        return next === state.selectedComponentIds
          ? {}
          : { selectedComponentIds: next };
      }),

    setConnectionSelected: (connectionId, selected) =>
      set((state) => {
        const next = withSelected(
          state.selectedConnectionIds,
          connectionId,
          selected,
        );
        return next === state.selectedConnectionIds
          ? {}
          : { selectedConnectionIds: next };
      }),

    setSelectedConnections: (connectionIds) =>
      set((state) =>
        sameIds(state.selectedConnectionIds, connectionIds)
          ? {}
          : { selectedConnectionIds: [...connectionIds] },
      ),

    setSelectedComponents: (componentIds) =>
      set((state) =>
        sameIds(state.selectedComponentIds, componentIds)
          ? {}
          : { selectedComponentIds: [...componentIds] },
      ),

    selectOnlyComponent: (componentId) =>
      set({
        selectedComponentIds: [componentId],
        selectedConnectionIds: [],
      }),

    clearSelection: () =>
      set({ selectedComponentIds: [], selectedConnectionIds: [] }),

    removeSelected: () => {
      const { selectedComponentIds, selectedConnectionIds, removeElements } =
        get();
      removeElements(selectedComponentIds, selectedConnectionIds);
    },

    setViewport: (viewport) =>
      set((state) => ({ document: { ...state.document, viewport } })),

    beginComponentDrag: () => {
      if (dragSnapshot) return;
      dragSnapshot = get().document;
    },

    endComponentDrag: () => {
      const snapshot = dragSnapshot;
      dragSnapshot = null;
      if (!snapshot) return;
      set((state) => {
        if (!positionsChanged(snapshot, state.document)) return {};
        return {
          past: [...state.past, snapshot].slice(-HISTORY_LIMIT),
          future: [],
        };
      });
    },

    beginComponentResize: () => {
      if (resizeSnapshot) return;
      resizeSnapshot = get().document;
    },

    endComponentResize: () => {
      const snapshot = resizeSnapshot;
      resizeSnapshot = null;
      if (!snapshot) return;
      set((state) => {
        if (!geometryChanged(snapshot, state.document)) return {};
        return {
          past: [...state.past, snapshot].slice(-HISTORY_LIMIT),
          future: [],
        };
      });
    },

    undo: () => set((state) => travel(state, "undo")),
    redo: () => set((state) => travel(state, "redo")),

    replaceDocument: (document) => {
      dragSnapshot = null;
      resizeSnapshot = null;
      set({
        document,
        past: [],
        future: [],
        selectedComponentIds: [],
        selectedConnectionIds: [],
      });
    },
  };
});
