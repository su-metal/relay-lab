/**
 * 経路確認モードの表示状態（design.md §5.15・§8.14）。
 *
 * `previewPaths()`（電位の到達範囲）を画面の色と文言へ落とす層。
 * `simulation-view.ts` と同じ役割分担で、**エンジンに表示都合を持ち込まない。**
 *
 * **色の語彙は増やさない。** 実行中と同じ `WireState` をそのまま使い、
 * 「予測である」ことは色ではなく**描き方**（破線・発光なし）で表す
 * —— `CircuitCanvas` 側の `data-preview` が受け持つ。ここで
 * `"preview-plus"` のような値を足すと、同じ意味の状態が 2 系統になり、
 * 片方だけ直す事故が起きる。
 *
 * **`deviceOf` は空のまま返す。** `DeviceNodeData.simulation` の有無が
 * 「シミュレーション中か」を表す唯一の合図で（`reactflow.ts`）、そこへ
 * 予測を混ぜると部品が動いているように見える。経路確認で塗るのは
 * 端子と配線だけ —— 励磁するコイルは、その両端の線が通電色になることで読める。
 *
 * **スイッチの操作だけは例外で、`DeviceNodeData.preview` が別に運ぶ**
 * （§8.14）。倒した／倒していないは人が決めたことで、回路を解いた結果では
 * ないので、`simulation` に混ぜずに済む。
 *
 * このファイルは React を import しない純粋関数なので node 環境の Vitest で検証できる。
 */

import { analogSignalNets, previewPaths, resolveAnalog } from "@/circuit/engine";
import type { PreviewBlocker } from "@/circuit/engine";
import type {
  CircuitDocument,
  ComponentDefinitionRegistry,
} from "@/circuit/types";
import { terminalKey } from "@/circuit/types";

import {
  IDLE_SIMULATION_VIEW,
  loadNetIds,
  wireStateOfNet,
  type SimulationView,
  type WireState,
} from "./simulation-view";

/**
 * 電位が止まっている 1 箇所を、画面に出せる言葉にしたもの。
 *
 * 端子は **ラベル（実端子番号）** で出す。「RY1 の接点」ではなく
 * 「RY1 の 9 → 5」と言えることがこのプロダクトの価値そのもの。
 */
export type PathPreviewBlocker = {
  componentId: string;
  /** 部品の呼び名（"S1" / "MY4N-D2"） */
  name: string;
  /** 電位が届いている端子のラベル */
  fedLabel: string;
  /** その先の、まだ届いていない端子のラベル */
  blockedLabel: string;
  /** 届いているのが電源のどちら側か */
  side: "plus" | "zero";
  /** 何が起きればこの先へ進むか */
  action: string;
};

export type PathPreviewView = {
  /**
   * 端子と配線の色。`deviceOf` は常に空。
   *
   * `SimulationView` をそのまま名乗るのは、`toDeviceNodes()` と
   * `WIRE_CLASS` を実行中と共有するため。
   */
  view: SimulationView;
  /** 電位が止まっている箇所。部品の並び順 */
  blockers: readonly PathPreviewBlocker[];
  /** 電位が止まっている部品のインスタンス ID（キャンバスの目印用） */
  blockedComponentIds: ReadonlySet<string>;
  /** この状態で成立している負荷（励磁するコイル・点灯するランプ）の数 */
  activeLoadCount: number;
};

/** 経路確認モードでないときのビュー。何も塗らない */
export const EMPTY_PATH_PREVIEW: PathPreviewView = {
  view: IDLE_SIMULATION_VIEW,
  blockers: [],
  blockedComponentIds: new Set(),
  activeLoadCount: 0,
};

/**
 * この接点・スイッチが閉じるために何が要るかを言う。
 *
 * **型番では分岐しない**（CLAUDE.md 設計原則 2）。見るのは
 * `ElectricalDefinition.kind` と、リレーなら限時の有無だけ。
 */
const actionFor = (
  definitions: ComponentDefinitionRegistry,
  definitionId: string,
  operated: boolean,
): string => {
  const electrical = definitions.get(definitionId)?.electrical;
  if (electrical?.kind === "switch") {
    /*
      **開いている理由は接点の種別ではなく、いま操作されているかで決まる。**
      a 接点は倒していないから開いており、b 接点は倒したから開いている。
      種別だけを見て「操作すると閉じます」と出すと、既に倒している b 接点に
      向かって「もっと倒せ」と言うことになる。
    */
    return operated ? "操作をやめると閉じます" : "操作すると閉じます";
  }
  if (electrical?.kind === "relay") {
    return electrical.delay
      ? "この限時接点が動作すると閉じます"
      : "このリレーが動作すると閉じます";
  }
  return "閉じると先へ進みます";
};

/** 端子 ID を画面表示用のラベルにする。定義に無い端子は ID をそのまま返す */
const labelOf = (
  definitions: ComponentDefinitionRegistry,
  definitionId: string,
  terminalId: string,
): string =>
  definitions
    .get(definitionId)
    ?.terminals.find((terminal) => terminal.id === terminalId)?.label ??
  terminalId;

const describeBlockers = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
  blockers: readonly PreviewBlocker[],
  pressedSwitches: ReadonlySet<string>,
): PathPreviewBlocker[] => {
  const instances = new Map(
    document.components.map((instance) => [instance.id, instance]),
  );

  const described: PathPreviewBlocker[] = [];
  for (const blocker of blockers) {
    const instance = instances.get(blocker.componentId);
    if (!instance) continue;
    const definition = definitions.get(instance.definitionId);
    if (!definition) continue;

    described.push({
      componentId: blocker.componentId,
      name: instance.label ?? definition.model,
      fedLabel: labelOf(definitions, instance.definitionId, blocker.fedTerminalId),
      blockedLabel: labelOf(
        definitions,
        instance.definitionId,
        blocker.blockedTerminalId,
      ),
      side: blocker.side,
      action: actionFor(
        definitions,
        instance.definitionId,
        pressedSwitches.has(blocker.componentId),
      ),
    });
  }
  return described;
};

/**
 * 経路確認モードの表示状態を組み立てる。
 *
 * 1 回解くだけで収束ループは回らない。計算量は端子数に線形の Union-Find で、
 * `buildWireRoles()`（3 回のネット構築）より軽い —— スイッチを倒すたびに
 * 解き直しても重くならない。
 *
 * `pressedSwitches` は経路確認モードで**倒しているスイッチ**（§8.14）。
 * リレーは渡さない —— 接点は動かないのがこのモードの約束（§5.15）。
 */
export const buildPathPreview = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
  pressedSwitches: ReadonlySet<string> = new Set(),
): PathPreviewView => {
  if (document.components.length === 0) return EMPTY_PATH_PREVIEW;

  const preview = previewPaths(document, definitions, { pressedSwitches });
  /*
   * アナログ層はこのモードでも重ねる（design.md §5.17）。接点が動かなくても
   * 調光信号は乗っており、**外すと調光線だけが灰（非通電）に戻る** ——
   * 実行中に見えていた「効いている線」が経路確認に切り替えた途端に
   * 消えるのは、同じ色の語彙を共有している意味が無い。
   */
  const analog = resolveAnalog(document, definitions, preview.netOf, preview.netState);
  const analogNets = analogSignalNets(analog);
  const energizedNets = loadNetIds(
    document,
    definitions,
    preview.netOf,
    preview.energizedCoils,
    preview.litLamps,
  );

  const terminalOf = new Map<string, WireState>();
  const terminalVoltsOf = new Map<string, number>();
  for (const instance of document.components) {
    const definition = definitions.get(instance.definitionId);
    if (!definition) continue;
    for (const terminal of definition.terminals) {
      const key = terminalKey(instance.id, terminal.id);
      const netId = preview.netOf.get(key);
      terminalOf.set(
        key,
        wireStateOfNet(netId, preview.netState, energizedNets, analogNets),
      );
      const signal = netId === undefined ? undefined : analog.signalOf.get(netId);
      if (signal) terminalVoltsOf.set(key, signal.volts);
    }
  }

  /*
   * 配線の色は端子と同じネットの色。両端は同一ネットなので from 側だけ見ればよい。
   *
   * 自己保持の紫（§5.9）はここには出ない。**保持は「励磁したリレーが自分の
   * 接点で給電を保つ」状態**であり、リレーが一切動かないこのモードには
   * そもそも存在しない（スイッチを倒しても同じ）。
   */
  const wireOf = new Map<string, WireState>();
  const wireVoltsOf = new Map<string, number>();
  for (const connection of document.connections) {
    const key = terminalKey(
      connection.from.componentId,
      connection.from.terminalId,
    );
    wireOf.set(connection.id, terminalOf.get(key) ?? "inactive");
    const volts = terminalVoltsOf.get(key);
    if (volts !== undefined) wireVoltsOf.set(connection.id, volts);
  }

  const blockers = describeBlockers(
    document,
    definitions,
    preview.blockers,
    pressedSwitches,
  );

  return {
    view: {
      wireOf,
      terminalOf,
      deviceOf: new Map(),
      wireVoltsOf,
      terminalVoltsOf,
    },
    blockers,
    blockedComponentIds: new Set(
      blockers.map((blocker) => blocker.componentId),
    ),
    activeLoadCount: preview.energizedCoils.size + preview.litLamps.size,
  };
};
