"use client";

/**
 * 回路ドキュメントのストア（design.md §7）。
 *
 * 保持するのは **保存対象である `CircuitDocument` と選択状態だけ。**
 * シミュレーションの実行時状態は `simulationStore`（Step 4）に分ける。
 * 混ぜると保存 JSON に実行時状態が混入し、Undo 履歴も汚れる。
 *
 * Undo / Redo（`{ past, present, future }`）は Step 6 で本ファイルに載せる。
 * その際のスナップショット地点は「部品追加 / 削除 / 配線確定 / ドラッグ完了」で、
 * ドラッグ中の `moveComponent` は履歴に積まない（毎フレーム発火するため）。
 */

import { create } from "zustand";

import {
  connectionFromReactFlow,
  hasTerminalPair,
} from "@/circuit/adapter/reactflow";
import type {
  CircuitDocument,
  ComponentCategory,
  ComponentDefinition,
} from "@/circuit/types";
import type { Connection } from "@xyflow/react";

type Point = { x: number; y: number };
type Viewport = { x: number; y: number; zoom: number };

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
  selectedComponentIds: readonly string[];
  selectedConnectionIds: readonly string[];

  /** パレットからのドロップ。`position` はキャンバス座標系の左上 */
  addComponent: (definition: ComponentDefinition, position: Point) => string;
  moveComponent: (componentId: string, position: Point) => void;
  removeComponents: (componentIds: readonly string[]) => void;

  /**
   * インスタンスのラベル（"RY1"）を変更する。空文字は未設定（`undefined`）に戻す。
   *
   * 1 文字ごとに発火するので **Undo 履歴には積まない**（Step 6 のスナップショット
   * 地点は 部品追加 / 削除 / 配線確定 / ドラッグ完了 の 4 点。design.md §7）。
   */
  setComponentLabel: (componentId: string, label: string) => void;

  /**
   * React Flow の接続イベントから配線を足す。
   * 端子以外への接続と重複配線はここで捨てる（adapter が判定する）。
   */
  addConnection: (params: Connection) => void;
  removeConnections: (connectionIds: readonly string[]) => void;

  setComponentSelected: (componentId: string, selected: boolean) => void;
  setConnectionSelected: (connectionId: string, selected: boolean) => void;
  clearSelection: () => void;
  removeSelected: () => void;

  setViewport: (viewport: Viewport) => void;
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

export const useCircuitStore = create<CircuitStore>()((set, get) => ({
  document: emptyDocument(),
  selectedComponentIds: [],
  selectedConnectionIds: [],

  addComponent: (definition, position) => {
    const id = createId("cmp");
    set((state) => ({
      document: {
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
      },
    }));
    return id;
  },

  moveComponent: (componentId, position) =>
    set((state) => ({
      document: {
        ...state.document,
        components: state.document.components.map((component) =>
          component.id === componentId ? { ...component, position } : component,
        ),
      },
    })),

  setComponentLabel: (componentId, label) => {
    // 入力値をそのまま持つ。ここで trim すると「RY 1」の途中（"RY "）で
    // 空白が消えてしまい、制御された input に文字が打てなくなる。
    // 前後の空白落としは入力欄を離れたときに UI 側が行う
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

  removeComponents: (componentIds) => {
    if (componentIds.length === 0) return;
    const removed = new Set(componentIds);
    set((state) => ({
      document: {
        ...state.document,
        components: state.document.components.filter(
          (component) => !removed.has(component.id),
        ),
        // 部品が消えたら、その端子に繋がっていた配線も必ず道連れにする。
        // 残すと存在しない端子を指す接続がドキュメントに居座る
        connections: state.document.connections.filter(
          (connection) =>
            !removed.has(connection.from.componentId) &&
            !removed.has(connection.to.componentId),
        ),
      },
      selectedComponentIds: state.selectedComponentIds.filter(
        (id) => !removed.has(id),
      ),
    }));
  },

  addConnection: (params) => {
    const candidate = connectionFromReactFlow(params, createId("wire"));
    // 端子 → 端子 でない接続は表現しない（要件 US-B）
    if (!candidate) return;
    if (hasTerminalPair(get().document, candidate)) return;
    set((state) => ({
      document: {
        ...state.document,
        connections: [...state.document.connections, candidate],
      },
    }));
  },

  removeConnections: (connectionIds) => {
    if (connectionIds.length === 0) return;
    const removed = new Set(connectionIds);
    set((state) => ({
      document: {
        ...state.document,
        connections: state.document.connections.filter(
          (connection) => !removed.has(connection.id),
        ),
      },
      selectedConnectionIds: state.selectedConnectionIds.filter(
        (id) => !removed.has(id),
      ),
    }));
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

  clearSelection: () =>
    set({ selectedComponentIds: [], selectedConnectionIds: [] }),

  removeSelected: () => {
    const { selectedComponentIds, selectedConnectionIds } = get();
    get().removeConnections(selectedConnectionIds);
    get().removeComponents(selectedComponentIds);
  },

  setViewport: (viewport) =>
    set((state) => ({ document: { ...state.document, viewport } })),
}));
