/**
 * 端子間の接続（design.md §3.3）。
 *
 * 接続は必ず「端子 → 端子」。部品そのものへの接続は表現できない。
 * React Flow の Edge とは同一視せず、adapter 層で相互変換する
 * （CLAUDE.md 設計原則 4）。
 */

/** 回路内の 1 端子を指す参照 */
export type TerminalRef = {
  /** 部品インスタンス ID（`ComponentDefinition.id` ではない） */
  componentId: string;
  /** `TerminalDefinition.id` */
  terminalId: string;
};

export type CircuitConnection = {
  id: string;
  from: TerminalRef;
  to: TerminalRef;
};

/**
 * 端子参照を Map / Set のキーにするための文字列化。
 *
 * `SimulationResult.netOf` のキー書式はここに閉じる。
 * 各所で `` `${a}:${b}` `` を手書きすると書式がずれた瞬間に
 * ネット引きが静かに失敗するため、必ずこの関数を通すこと。
 */
export const terminalKey = (componentId: string, terminalId: string): string =>
  `${componentId}:${terminalId}`;

/** `TerminalRef` から文字列キーを作る */
export const terminalRefKey = (ref: TerminalRef): string =>
  terminalKey(ref.componentId, ref.terminalId);
