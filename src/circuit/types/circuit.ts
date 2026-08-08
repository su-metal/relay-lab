/**
 * 回路ドキュメント（design.md §3.3）。
 *
 * これが保存対象（LocalStorage への永続化単位）。
 * シミュレーションの実行時状態はここに含めない — 混ぜると保存 JSON に
 * 実行時状態が混入し、Undo 履歴も汚れる（design.md §7）。
 */

import type { CircuitConnection } from "./connection";

export type CircuitComponentInstance = {
  /** インスタンス ID。回路内で一意 */
  id: string;
  /** 参照する `ComponentDefinition.id` */
  definitionId: string;
  /** "RY1" "S1" などのユーザー付与名 */
  label?: string;
  position: { x: number; y: number };
};

export type CircuitDocument = {
  version: 1;
  components: CircuitComponentInstance[];
  connections: CircuitConnection[];
  viewport: { x: number; y: number; zoom: number };
};
