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

import {
  buildNets,
  closedContactPairs,
  computeNetStates,
  describeComponent,
  inspectDiodes,
} from "@/circuit/engine";
import type { DiodeInspection, NetLookup } from "@/circuit/engine";
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

import { EMPTY_SELF_HOLD, type SelfHoldView } from "./self-hold";
import { buildSimulationView } from "./simulation-view";
import type { DeviceSimulationState, WireState } from "./simulation-view";

/** SPDT の COM がどちら側に倒れているか */
/**
 * いま COM が倒れている側。
 *
 * `"open"` は **どこにも閉じていない**状態で、a 接点のみ（`SPST-NO`）の
 * リレーが非励磁のときに起きる。c 接点なら必ず `"no"` か `"nc"` のどちらかになる。
 */
export type ClosedSide = "no" | "nc" | "open";

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

/**
 * ダイオード 1 個の向きと役割。
 *
 * 判定そのものはエンジン（`engine/diode.ts`）が持っており、
 * ここで足すのは表示用の呼び名だけ。パネルは相手のリレーを選択していないので
 * インスタンス ID から名前を引けない。
 */
export type DiodeRoleInspection = DiodeInspection & {
  /** 並列に入っているコイルを持つリレーの呼び名。並列でなければ `undefined` */
  flybackRelayName?: string;
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
   * ダイオードの向きと役割。ダイオード以外は `undefined`。
   *
   * **停止中でも入る。** 「コイルと並列に、正しい向きで入っているか」は
   * 配線そのものの性質であって実行中にしか決まらない値ではない
   * （design.md §5.4）。逆向きに挿してあることは動かす前に読めるべき。
   */
  diode?: DiodeRoleInspection;
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
 * `selfHold` だけは**受け取るだけで組み直さない**（design.md §5.9）。
 * 検出に `simulate()` の再実行が要るので、呼び出し側の `useMemo` に任せる。
 * 省略するとパネルに紫（自己保持）が出ず、キャンバスと食い違うので注意。
 *
 * @returns 部品または定義が見つからなければ `null`
 */
export const inspectComponent = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
  result: SimulationResult | null,
  pressedSwitches: ReadonlySet<string>,
  componentId: string | undefined,
  selfHold: SelfHoldView = EMPTY_SELF_HOLD,
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
    selfHold,
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

  const diode =
    electrical.kind === "diode"
      ? inspectDiode(
          document,
          definitions,
          result ?? restingNets(document, definitions, pressedSwitches),
          instance.id,
        )
      : undefined;

  return {
    instance,
    definition,
    device,
    contacts,
    terminals,
    diode,
    conducting,
  };
};

/** 選択中のダイオード 1 個ぶんを取り出し、相手リレーの呼び名を足す */
const inspectDiode = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
  lookup: NetLookup,
  componentId: string,
): DiodeRoleInspection | undefined => {
  const diode = inspectDiodes(document, definitions, lookup).find(
    (entry) => entry.componentId === componentId,
  );
  if (!diode) return undefined;

  const relay = diode.flyback
    ? document.components.find(
        (component) => component.id === diode.flyback?.relayId,
      )
    : undefined;
  const relayDefinition = relay
    ? definitions.get(relay.definitionId)
    : undefined;

  return {
    ...diode,
    flybackRelayName:
      relay && relayDefinition
        ? describeComponent(relay, relayDefinition)
        : undefined,
  };
};

/**
 * 停止中に使う静止状態のネット（全リレー非励磁）。
 *
 * ダイオードがコイルと並列かどうかは配線の性質なので、動かす前にも読めるように
 * ここだけネットを組み直す。`SimulationResult` はネット構築の結果を
 * そのまま持っている（`netOf` / `netState`）ので、実行中はそれを使う。
 */
const restingNets = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
  pressedSwitches: ReadonlySet<string>,
): NetLookup => {
  const nets = buildNets(document, definitions, { pressedSwitches }, new Set());
  return {
    netOf: nets.netOf,
    netState: computeNetStates(document, definitions, nets),
  };
};

/**
 * 接点ごとの開閉を読む。
 *
 * 「非励磁なら COM–NC、励磁なら COM–NO。ただし NC 端子が無ければ非励磁で
 * どこにも閉じない」という規則はエンジン側（`closedContactPairs`）に
 * 1 箇所だけ置いてある。ここで `energized ? "no" : "nc"` と書き直すと
 * 規則が 2 箇所に増えるので、エンジンの答えを引き直して COM の相手を見る。
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
    const other = closedOf.get(contact.commonTerminal);
    if (other === contact.noTerminal) return "no";
    // NC 端子を持たない a 接点は、非励磁で相手がいない。
    // ここを "nc" に丸めると存在しない b 接点が導通していることになる
    return other === undefined ? "open" : "nc";
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
