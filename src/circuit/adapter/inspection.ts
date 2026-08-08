/**
 * プロパティパネルが読む「部品 1 個の中身」（design.md §8.3）。
 *
 * 静的な仕様（コイル電圧・接点構成・端子番号）は `ComponentDefinition` を
 * そのまま読めば足りるので、ここでは組み直さない。
 * **このファイルが受け持つのは実行中にしか決まらない部分だけ** —
 * 接点がどちらへ倒れているか、端子が今どの電位にいるか。
 *
 * `simulation-view.ts` と同じく React を import しない純粋関数なので、
 * UI を起動せずに Vitest で「押したら表示が切り替わる」ところまで検証できる。
 */

import { closedContactPairs } from "@/circuit/engine";
import type {
  CircuitComponentInstance,
  CircuitDocument,
  ComponentDefinition,
  ComponentDefinitionRegistry,
  RelayContact,
  RelayDefinition,
  SimulationResult,
  TerminalDefinition,
} from "@/circuit/types";
import { terminalKey } from "@/circuit/types";

import { buildSimulationView } from "./simulation-view";
import type { DeviceSimulationState, WireState } from "./simulation-view";

/** SPDT の COM がどちら側に倒れているか */
export type ClosedSide = "no" | "nc";

export type ContactInspection = {
  contact: RelayContact;
  /** 何回路目か（1 始まり）。定義の `contacts` の並び順をそのまま採る */
  order: number;
  /** いま閉じている側。**停止中は `undefined`** */
  closed?: ClosedSide;
};

export type TerminalInspection = {
  terminal: TerminalDefinition;
  /** 端子の電位状態。**停止中は `undefined`** */
  state?: WireState;
};

export type ComponentInspection = {
  instance: CircuitComponentInstance;
  definition: ComponentDefinition;
  /**
   * 実行中の部品状態。**`undefined` が「シミュレーション停止中」を表す。**
   * `DeviceNodeData.simulation` と同じ約束（design.md §8.2）で、
   * 「消磁している」と「そもそも動いていない」を別物として描き分けられる。
   */
  device?: DeviceSimulationState;
  /** リレーの接点。リレー以外は空配列 */
  contacts: ContactInspection[];
  terminals: TerminalInspection[];
  /**
   * スイッチの 2 端子がいま導通しているか。スイッチ以外・停止中は `undefined`。
   *
   * 開閉の規則（A 接点は押下中だけ閉じる）は `engine/graph.ts` の持ち物なので
   * ここで再実装せず、**両端が同じネットに居るか**で読む。
   * 表示したいのは規則ではなく結果であり、外部配線で短絡していれば
   * それも「導通している」と出るのが正しい。
   */
  conducting?: boolean;
};

/**
 * 選択中の部品 1 個を読み取る。
 *
 * 引数は `buildSimulationView()` と同じ並びに `componentId` を足しただけ。
 * ビューはここで組み直す（O(部品数)）。パネルは 1 部品しか見ないが、
 * 端子の電位は「通電中の負荷に隣接するか」を回路全体から決めるため
 * （design.md §5.6）、部分計算では求められない。
 *
 * @returns 部品または定義が見つからなければ `null`
 */
export const inspectComponent = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
  result: SimulationResult | null,
  pressedSwitches: ReadonlySet<string>,
  componentId: string | undefined,
): ComponentInspection | null => {
  if (!componentId) return null;

  const instance = document.components.find(
    (component) => component.id === componentId,
  );
  if (!instance) return null;

  const definition = definitions.get(instance.definitionId);
  if (!definition) return null;

  const view = buildSimulationView(
    document,
    definitions,
    result,
    pressedSwitches,
  );
  const device = view.deviceOf.get(instance.id);

  const terminals = definition.terminals.map<TerminalInspection>(
    (terminal) => ({
      terminal,
      state: view.terminalOf.get(terminalKey(instance.id, terminal.id)),
    }),
  );

  const { electrical } = definition;

  const contacts: ContactInspection[] =
    electrical.kind === "relay"
      ? inspectContacts(electrical.relay, device)
      : [];

  const conducting =
    electrical.kind === "switch" && result
      ? sameNet(
          result,
          instance.id,
          electrical.terminalA,
          electrical.terminalB,
        )
      : undefined;

  return { instance, definition, device, contacts, terminals, conducting };
};

/**
 * 接点ごとの開閉を読む。
 *
 * SPDT が「非励磁なら COM–NC、励磁なら COM–NO」という規則はエンジン側
 * （`closedContactPairs`）に 1 箇所だけ置いてある。ここで
 * `energized ? "no" : "nc"` と書き直すと規則が 2 箇所に増えるので、
 * エンジンの答えを引き直して COM の相手が NO かどうかで判定する。
 */
const inspectContacts = (
  relay: RelayDefinition,
  device: DeviceSimulationState | undefined,
): ContactInspection[] => {
  // COM の相手を引ける形にする。COM 端子はリレー内で一意なのでキーにできる
  const closedOf = device
    ? new Map<string, string>(closedContactPairs(relay, device.energized))
    : undefined;

  const sideOf = (contact: RelayContact): ClosedSide | undefined => {
    if (!closedOf) return undefined;
    return closedOf.get(contact.commonTerminal) === contact.noTerminal
      ? "no"
      : "nc";
  };

  return relay.contacts.map((contact, index) => ({
    contact,
    order: index + 1,
    closed: sideOf(contact),
  }));
};

/** 同一部品内の 2 端子が同じネットに属するか */
const sameNet = (
  result: SimulationResult,
  componentId: string,
  terminalA: string,
  terminalB: string,
): boolean => {
  const a = result.netOf.get(terminalKey(componentId, terminalA));
  const b = result.netOf.get(terminalKey(componentId, terminalB));
  return a !== undefined && a === b;
};
