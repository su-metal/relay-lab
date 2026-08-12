/**
 * `SimulationResult` を画面表示用の状態へ落とす層（design.md §5.6・§8.2）。
 *
 * エンジンが返すのはネットごとの「どの電源の + / 0V に届くか」まで。
 * **「緑＝通電中」は 2 ビットだけでは決まらない**（design.md §5.6）ので、
 * 負荷側の結果（`energizedRelays` / `litLamps`）と突き合わせてここで決める。
 * この判断を UI 層に置いたのは、エンジンに表示都合を持ち込まないため。
 *
 * このファイルは React を import しない純粋関数なので、node 環境の Vitest で検証できる。
 */

import {
  coilEnergized,
  isShorted,
  presetMsOf,
  reachesPlus,
  reachesZero,
  timerNextEventAtMs,
} from "@/circuit/engine";
import type {
  CircuitComponentInstance,
  CircuitDocument,
  ComponentDefinition,
  ComponentDefinitionRegistry,
  SimulationResult,
} from "@/circuit/types";
import { terminalKey } from "@/circuit/types";

import { EMPTY_SELF_HOLD, type SelfHoldView } from "./self-hold";

/**
 * 端子・配線の表示状態（design.md §5.6 の表に対応）。
 *
 * `short` を独立させているのは、同じ電源の + と 0V が同じネットに乗る状態が
 * 「通電中」ではなく **電源短絡そのもの**だから。負荷をグラフ上で union しない
 * 設計（design.md §5.2）の下では、正常な回路にこのネットは現れない。
 */
export type WireState =
  /** どちらの電源にも到達しない */
  | "inactive"
  /** + 側のみに到達 */
  | "plus"
  /** 0V 側のみに到達 */
  | "zero"
  /** 通電中の負荷（励磁コイル・点灯ランプ）に隣接する */
  | "energized"
  /**
   * 自己保持しているリレーのコイルを、そのリレー自身の接点が支えている枝
   * （design.md §5.9）。通電中（`energized`）の一部を切り出したもので、
   * **この線を切ればリレーが落ちる**という意味を持つ。
   */
  | "self-hold"
  /** + と 0V が同一ネット＝電源短絡 */
  | "short";

/**
 * 部品 1 個のシミュレーション状態。
 *
 * **この値が `undefined` であることが「シミュレーション停止中」を意味する。**
 * 別途 `running` フラグを持たせると、停止中なのに `energized: false` が
 * 描画側へ流れてしまい「消磁した」と「動いていない」を区別できなくなる。
 */
/**
 * タイマー 1 個の表示状態（design.md §5.13）。タイマー以外では持たない。
 *
 * **コイルと接点を分けて持つ。** タイマーは「コイルは入っているが接点は
 * まだ動いていない」という状態を必ず通る —— そこが読めないと、
 * カウント中なのか止まっているのかが画面から分からない。
 */
export type TimerDisplayState = {
  mode: "on-delay" | "off-delay";
  /** 設定時間（ms） */
  presetMs: number;
  /** コイルに電圧がかかっているか */
  coilOn: boolean;
  /**
   * 接点が動くまでの残り（ms）。カウントしていなければ `undefined`。
   * これが入っていることが「今まさに計っている」の合図になる。
   */
  remainingMs?: number;
};

export type DeviceSimulationState = {
  /**
   * **接点が切り替わっているか**（`SimulationResult.energizedRelays`）。
   *
   * 遅延なしのリレーではコイルの励磁と一致する。タイマーではずれるので、
   * コイルの側は `timer.coilOn` を見ること（design.md §5.13）。
   */
  energized: boolean;
  /**
   * そのリレーが**自分の接点で自分を保持している**か（design.md §5.9）。
   * `energized` が true のときだけ true になりうる。ボタンを押している間は
   * 外部が保持しているので false —— 離した瞬間に true へ変わる。
   */
  selfHeld: boolean;
  /** ランプが点灯しているか */
  lit: boolean;
  /** 押しボタンが押下中か */
  pressed: boolean;
  /**
   * **操作しているのに、両端がどちらの電源にも届いていないスイッチ**
   * （design.md §5.12）。スイッチ以外は常に false。
   *
   * 「ON なのに配線が灰色」は、放っておくと**バグに見える。** 実際には
   * 正しい —— スイッチを閉じることは 2 点を繋ぐだけで、電流を作らない。
   * 先行優先回路のように「起動した瞬間に自分が回路から切り離される」
   * 使い方では、これが正常な最終状態になる。
   */
  cutOff: boolean;
  /** タイマーのときだけ入る（design.md §5.13） */
  timer?: TimerDisplayState;
};

export type SimulationView = {
  /** `CircuitConnection.id` → 配線の表示状態 */
  wireOf: ReadonlyMap<string, WireState>;
  /** `terminalKey()` → 端子の表示状態 */
  terminalOf: ReadonlyMap<string, WireState>;
  /** 部品インスタンス ID → 部品の状態 */
  deviceOf: ReadonlyMap<string, DeviceSimulationState>;
};

/** シミュレーション停止中のビュー。すべて空＝非通電で描かれる */
export const IDLE_SIMULATION_VIEW: SimulationView = {
  wireOf: new Map(),
  terminalOf: new Map(),
  deviceOf: new Map(),
};

/**
 * 通電中の負荷に隣接するネット ID を集める。
 *
 * 負荷は union されていない（design.md §5.2）ので、
 * 「電流が流れている経路」はネットの 2 ビットからは読み取れない。
 * 励磁したコイル・点灯したランプの両端のネットを辿るのが唯一の手がかり。
 */
const energizedNetIds = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
  result: SimulationResult,
): Set<number> => {
  const nets = new Set<number>();

  const add = (componentId: string, terminalId: string): void => {
    const netId = result.netOf.get(terminalKey(componentId, terminalId));
    if (netId !== undefined) nets.add(netId);
  };

  for (const instance of document.components) {
    const definition = definitions.get(instance.definitionId);
    if (!definition) continue;
    const { electrical } = definition;

    /*
     * **`energizedRelays` ではなくコイルの状態で見る。** カウント中のタイマーは
     * コイルに電流が流れているが接点はまだ動いていないので、`energizedRelays`
     * だけを見るとコイル配線が灰色になる（design.md §5.13）。
     */
    if (coilEnergized(result, instance.id, electrical)) {
      if (electrical.kind !== "relay") continue;
      add(instance.id, electrical.relay.coil.positiveTerminal);
      add(instance.id, electrical.relay.coil.negativeTerminal);
    }
    if (electrical.kind === "lamp" && result.litLamps.has(instance.id)) {
      add(instance.id, electrical.terminalA);
      add(instance.id, electrical.terminalB);
    }
  }

  return nets;
};

/**
 * タイマーの表示状態を組み立てる（design.md §5.13）。タイマー以外は `undefined`。
 *
 * 残り時間はここで**負にならないよう丸める。** 経過が設定を追い越した後も
 * 引き算の結果をそのまま出すと「残り -1.2 秒」という読めない表示になる。
 */
const timerDisplayOf = (
  instance: CircuitComponentInstance,
  definition: ComponentDefinition,
  result: SimulationResult,
  nowMs: number,
): TimerDisplayState | undefined => {
  const { electrical } = definition;
  if (electrical.kind !== "relay" || !electrical.delay) return undefined;

  const delay = electrical.delay;
  const presetMs = presetMsOf(delay, instance.presetMs);
  const state = result.timers.get(instance.id);
  if (!state) return { mode: delay.mode, presetMs, coilOn: false };

  const at = timerNextEventAtMs(delay, state, presetMs, nowMs);
  return {
    mode: delay.mode,
    presetMs,
    coilOn: state.coilOn,
    remainingMs: at === undefined ? undefined : Math.max(0, at - nowMs),
  };
};

/**
 * ネット 1 本の表示状態を決める（design.md §5.6）。
 *
 * 短絡の判定を最初に置くのは、短絡したネットを緑（正常な通電）として
 * 描いてしまうと、最も危険な配線ミスが最も安全に見えるため。
 */
const wireStateOfNet = (
  netId: number | undefined,
  result: SimulationResult,
  energizedNets: ReadonlySet<number>,
): WireState => {
  if (netId === undefined) return "inactive";
  const state = result.netState.get(netId);
  if (!state) return "inactive";
  if (isShorted(state)) return "short";
  if (energizedNets.has(netId)) return "energized";
  if (reachesPlus(state)) return "plus";
  if (reachesZero(state)) return "zero";
  return "inactive";
};

/**
 * 表示状態をまとめて組み立てる。
 *
 * @param result シミュレーション結果。停止中は `null`
 * @param pressedSwitches 押下中の押しボタンの componentId
 * @param selfHold 自己保持の検出結果（`self-hold.ts`）。省略時は色を足さない。
 *   ここで受け取るだけにして**計算しない**のは、検出に `simulate()` の再実行が
 *   要るため —— 表示状態の組み立てと同じ関数に混ぜると、色を引くたびに
 *   回路を解き直すことになる
 * @param nowMs `result` を解いた時刻（開始からの経過ミリ秒）。タイマーの
 *   残り時間の算出だけに使う。**ここでも時計は読まない**（design.md §5.13）
 */
export const buildSimulationView = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
  result: SimulationResult | null,
  pressedSwitches: ReadonlySet<string>,
  selfHold: SelfHoldView = EMPTY_SELF_HOLD,
  nowMs = 0,
): SimulationView => {
  if (!result) return IDLE_SIMULATION_VIEW;

  const energizedNets = energizedNetIds(document, definitions, result);

  const terminalOf = new Map<string, WireState>();
  const deviceOf = new Map<string, DeviceSimulationState>();

  for (const instance of document.components) {
    const definition = definitions.get(instance.definitionId);
    if (!definition) continue;

    for (const terminal of definition.terminals) {
      const key = terminalKey(instance.id, terminal.id);
      const state = wireStateOfNet(
        result.netOf.get(key),
        result,
        energizedNets,
      );
      /*
       * 自己保持の紫は緑（通電中）の中からだけ切り出す。`short` を上書きしない
       * ためで、判定順の理由は §5.6 と同じ —— 最も危険な配線ミスを、
       * より穏やかな色で塗り潰してはいけない。
       */
      terminalOf.set(
        key,
        state === "energized" && selfHold.terminals.has(key)
          ? "self-hold"
          : state,
      );
    }

    /*
     * 操作しているのに両端が非通電のスイッチ（§5.12）。
     *
     * **端子の色をここで組み終わってから判定する。** 「ON なのに灰色」は
     * まさに端子の色そのものから読み取れる矛盾であり、別の経路で導くと
     * 画面の色と食い違いうる。
     */
    const operated = pressedSwitches.has(instance.id);
    const cutOff =
      definition.electrical.kind === "switch" &&
      operated &&
      definition.terminals.every(
        (terminal) =>
          (terminalOf.get(terminalKey(instance.id, terminal.id)) ??
            "inactive") === "inactive",
      );

    // 実行中はすべての部品にエントリを作る。存在すること自体が
    // 「シミュレーション中」の合図になり、ノード側は追加の判定を持たずに済む
    deviceOf.set(instance.id, {
      energized: result.energizedRelays.has(instance.id),
      selfHeld: selfHold.relays.has(instance.id),
      lit: result.litLamps.has(instance.id),
      pressed: operated,
      cutOff,
      timer: timerDisplayOf(instance, definition, result, nowMs),
    });
  }

  /*
   * 配線の色は端子と同じネットの色。両端は同一ネットなので from 側だけ見ればよい。
   *
   * **自己保持の紫だけは端子から引けない**（design.md §5.9）。保持ループから
   * 行き止まりの線が枝分かれしていると、同じ端子から出ている 2 本のうち
   * 一方だけが「切れば落ちる線」になるため。配線は配線として判定する。
   */
  const wireOf = new Map<string, WireState>();
  for (const connection of document.connections) {
    const key = terminalKey(
      connection.from.componentId,
      connection.from.terminalId,
    );
    const state = terminalOf.get(key) ?? "inactive";
    wireOf.set(
      connection.id,
      state === "self-hold" && !selfHold.connections.has(connection.id)
        ? "energized"
        : state,
    );
  }

  return { wireOf, terminalOf, deviceOf };
};

/**
 * 1 部品ぶんの端子状態を切り出す（`TerminalDefinition.id` → 状態）。
 *
 * ノードは自分の端子しか描かないので、全体マップをそのまま渡さずに絞る。
 */
export const terminalStatesOf = (
  view: SimulationView,
  componentId: string,
  terminalIds: readonly string[],
): ReadonlyMap<string, WireState> | undefined => {
  if (view.terminalOf.size === 0) return undefined;
  const states = new Map<string, WireState>();
  for (const terminalId of terminalIds) {
    const state = view.terminalOf.get(terminalKey(componentId, terminalId));
    if (state) states.set(terminalId, state);
  }
  return states;
};
