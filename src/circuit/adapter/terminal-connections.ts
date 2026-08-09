/**
 * 端子ホバーの吹き出しに出す「接続先」情報（design.md §8.3）。
 *
 * ドキュメントの `CircuitConnection`（端子 → 端子）を、端子ごとの
 * 「どの部品のどの端子につながっているか」の一覧へ組み直す。
 * **配線そのもの**を見せる（ネットや、スイッチ・端子台の導通で間接的に
 * 繋がっている先までは辿らない）。辿ると無関係な部品まで列挙されて
 * 「この線がどこへ行くか」がかえって読めなくなるため。
 *
 * React を import しない純粋関数。
 */

import { describeComponent } from "@/circuit/engine";
import type {
  CircuitDocument,
  ComponentDefinitionRegistry,
  TerminalRef,
} from "@/circuit/types";
import { terminalRefKey } from "@/circuit/types";

/** 配線 1 本の相手側。ツールチップに出す最小限の情報だけ持つ */
export type ConnectedTerminalInfo = {
  /** 相手部品の呼び名（ラベルがあればラベル、無ければ型番） */
  componentName: string;
  /** 相手端子の画面表示ラベル（"14" など） */
  terminalLabel: string;
};

/**
 * ドキュメント全体を 1 回走査し、`terminalRefKey()` → 接続先一覧 の表を作る。
 *
 * 1 端子に複数の配線が集まることもある（端子台の分岐など）ので配列で持つ。
 * 定義や部品が見つからない端子（読み込み時に落ちた古いデータなど）は無視する。
 */
export const buildTerminalConnections = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
): ReadonlyMap<string, ConnectedTerminalInfo[]> => {
  const componentById = new Map(
    document.components.map((instance) => [instance.id, instance] as const),
  );

  const infoOf = (ref: TerminalRef): ConnectedTerminalInfo | null => {
    const instance = componentById.get(ref.componentId);
    if (!instance) return null;
    const definition = definitions.get(instance.definitionId);
    if (!definition) return null;
    const terminal = definition.terminals.find(
      (candidate) => candidate.id === ref.terminalId,
    );
    if (!terminal) return null;
    return {
      componentName: describeComponent(instance, definition),
      terminalLabel: terminal.label,
    };
  };

  const result = new Map<string, ConnectedTerminalInfo[]>();
  const add = (ref: TerminalRef, info: ConnectedTerminalInfo): void => {
    const key = terminalRefKey(ref);
    const list = result.get(key);
    if (list) list.push(info);
    else result.set(key, [info]);
  };

  for (const connection of document.connections) {
    // from 側の吹き出しには to 側の情報を、to 側の吹き出しには from 側の情報を出す
    const fromInfo = infoOf(connection.from);
    const toInfo = infoOf(connection.to);
    if (toInfo) add(connection.from, toInfo);
    if (fromInfo) add(connection.to, fromInfo);
  }

  return result;
};
