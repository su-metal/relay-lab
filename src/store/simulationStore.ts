"use client";

/**
 * シミュレーションの実行時状態（design.md §7）。
 *
 * 保持するのは `running` / `pressedSwitches` / 最新の `SimulationResult` だけで、
 * **保存対象には一切含めない。** `circuitStore` と混ぜると保存 JSON に実行時状態が
 * 混入し、Undo 履歴もシミュレーション中の変化で汚れる。
 *
 * このストアは `circuitStore` を **読むだけ**（`evaluate()` の中の `getState()`）。
 * 逆向きの依存は作らない。回路が変わればシミュレーションは解き直すべきだが、
 * シミュレーション結果が回路を書き換えることは無い、という一方向を保つ。
 */

import { create } from "zustand";

import { componentRegistry } from "@/circuit/definitions";
import { simulate } from "@/circuit/engine";
import { operationKey } from "@/circuit/types";
import type { SimulationResult } from "@/circuit/types";

import { useCircuitStore } from "./circuitStore";

const EMPTY_PRESSED: ReadonlySet<string> = new Set();

/**
 * タイマーのカウント中に解き直す間隔（ms）（design.md §5.13）。
 *
 * 残り時間の表示を滑らかにするための値。接点が変わる瞬間の誤差は最大でこの
 * 幅だが、秒単位のタイマーでは見えない。**`requestAnimationFrame` は使わない**
 * —— タイマーを 1 個も置いていない回路で CPU を回し続けることになる。
 * カウントしているタイマーが 1 個も無ければ（`nextEventAtMs` が無ければ）
 * このループ自体を止める。
 */
const TICK_INTERVAL_MS = 50;

export type SimulationStore = {
  running: boolean;
  /**
   * **操作中**のスイッチの componentId。
   * モーメンタリは押下中、オルタネートは ON 位置の間ずっと入る。
   * どちらも「操作された状態か」の 1 ビットなので集合を分けない
   * （エンジンは `action` を見て開閉を決める・design.md §4.7）。
   *
   * **実行中と経路確認中で同じ 1 つを使う**（design.md §8.14）。2 つ持つと
   * 「▶ で押した状態」と「経路確認で倒した状態」がずれ、モードを行き来した
   * ときにどちらが効いているのか読めなくなる。モードの切り替えで必ず空へ戻す。
   */
  pressedSwitches: ReadonlySet<string>;
  /**
   * 人が倒している機器の操作（`operationKey()` の文字列・design.md §4.16）。
   *
   * **`pressedSwitches` と分けて持つ。** キーの形が違う（あちらは
   * componentId、こちらは `componentId:operationId`）ので、同じ集合に
   * 混ぜると「倒したのに動かない」が静かに起きる。
   */
  operatedDevices: ReadonlySet<string>;
  /** 最新の結果。停止中は null */
  result: SimulationResult | null;
  /**
   * `result` を解いた時刻（開始からの経過ミリ秒）。停止中は 0。
   *
   * **`result` と対で持つ。** 残り時間の表示（`buildSimulationView`）は
   * 「その結果を解いたのが何 ms 地点か」を知らないと計算できず、描画のたびに
   * 時計を読むと結果と表示がずれる（design.md §5.13）。
   */
  nowMs: number;
  /**
   * 経路確認モード（design.md §8.14）。**▶ とは排他。**
   *
   * 電位の到達範囲を塗るモードで、時間は進まない。実行と同時に立てられる
   * ようにすると、同じ線に「今流れている」と「電源を入れれば流れる」の
   * 2 つの意味が同時に載る。
   *
   * **スイッチは倒せるが、リレーは動かない**（design.md §5.15）。倒した先が
   * どこまで届くかを読むためのモードで、リレーまで動かすと収束ループが要り、
   * 実質「時間の進まない ▶」になる。
   *
   * `running` と同じく**保存対象ではない。**
   */
  pathPreview: boolean;

  start: () => void;
  stop: () => void;
  /** 経路確認モードを切り替える。入るときは実行を止め、出入りで押下状態を捨てる */
  togglePathPreview: () => void;

  /**
   * モーメンタリ操作。マウスダウンで押下、マウスアップで復帰する。
   * **実行中と経路確認中だけ効く** —— 停止中の操作は無視する
   * （結果が無いのに入力だけ溜まるのを防ぐ）。
   */
  pressSwitch: (componentId: string) => void;
  releaseSwitch: (componentId: string) => void;

  /**
   * オルタネート操作。1 回で ON 位置に入り、もう 1 回で戻る。
   * 停止中は無視する（`pressSwitch` と同じ理由）。
   */
  toggleSwitch: (componentId: string) => void;

  /**
   * 機器の操作を倒す（操作卓のボタン・design.md §4.16）。
   * 停止中は無視する（`toggleSwitch` と同じ理由）。
   */
  toggleOperation: (componentId: string, operationId: string) => void;

  /**
   * 現在の回路と入力で解き直す。
   * 入力（回路 / 押下状態 / 実行状態）が変わるたびに `useSimulationSync` が呼ぶ。
   */
  evaluate: () => void;
};

/**
 * 実時間の基準（design.md §5.13）。**時計を読むのはこのストアだけ。**
 *
 * エンジンは `nowMs` を入力として受け取る純粋関数のままで（CLAUDE.md 設計原則 1）、
 * テストは時刻を直接指定して書ける。ストアの状態には入れない —— 描画に使う値では
 * ないので、更新しても再描画を起こしてはいけない。
 */
let startedAt = 0;

/** カウント中だけ回すタイマー。止め忘れると停止後も解き続ける */
let tickHandle: ReturnType<typeof setInterval> | null = null;

const stopTicking = (): void => {
  if (tickHandle === null) return;
  clearInterval(tickHandle);
  tickHandle = null;
};

export const useSimulationStore = create<SimulationStore>()((set, get) => ({
  running: false,
  pressedSwitches: EMPTY_PRESSED,
      operatedDevices: EMPTY_PRESSED,
    result: null,
  nowMs: 0,
  pathPreview: false,

  // 開始時は前回の結果を捨てる。残すと前回の励磁状態が
  // `previousEnergizedRelays` として引き継がれ、押していない自己保持回路が
  // 最初から励磁した状態で立ち上がってしまう
  start: () => {
    stopTicking();
    startedAt = performance.now();
    set({
      running: true,
      pressedSwitches: EMPTY_PRESSED,
      operatedDevices: EMPTY_PRESSED,
        result: null,
      nowMs: 0,
      // 実行が始まったら予測の色は下ろす。排他はここ 1 箇所で守る
      pathPreview: false,
    });
  },

  stop: () => {
    stopTicking();
    set({
      running: false,
      pressedSwitches: EMPTY_PRESSED,
      operatedDevices: EMPTY_PRESSED,
        result: null,
      nowMs: 0,
    });
  },

  /*
   * **入るときに実行を止める。** 「実行中は押せない」にすると、動かしたまま
   * 配線を読み直したくなったときに ■ を先に押させることになり、
   * ボタンが 2 度手間になる。止まるという結果は同じ。
   */
  togglePathPreview: () => {
    if (get().pathPreview) {
      // 出るときも倒した状態を捨てる。残すと停止中の役割配色に戻ったあとも
      // 見えない操作が効いたままになり、次に ⚡ を押すと勝手に倒れて見える
      set({
        pathPreview: false,
        pressedSwitches: EMPTY_PRESSED,
        operatedDevices: EMPTY_PRESSED,
      });
      return;
    }
    stopTicking();
    set({
      pathPreview: true,
      running: false,
      pressedSwitches: EMPTY_PRESSED,
      operatedDevices: EMPTY_PRESSED,
        result: null,
      nowMs: 0,
    });
  },

  pressSwitch: (componentId) =>
    set((state) => {
      // 実行中と経路確認中だけ受け付ける。停止中は結果が無いのに入力だけ溜まる
      if (!state.running && !state.pathPreview) return {};
      if (state.pressedSwitches.has(componentId)) return {};
      const next = new Set(state.pressedSwitches);
      next.add(componentId);
      return { pressedSwitches: next };
    }),

  releaseSwitch: (componentId) =>
    set((state) => {
      if (!state.pressedSwitches.has(componentId)) return {};
      const next = new Set(state.pressedSwitches);
      next.delete(componentId);
      return { pressedSwitches: next };
    }),

  toggleSwitch: (componentId) =>
    set((state) => {
      if (!state.running && !state.pathPreview) return {};
      const next = new Set(state.pressedSwitches);
      // delete は「消せたか」を返す。ON なら OFF へ、OFF なら ON へ
      if (!next.delete(componentId)) next.add(componentId);
      return { pressedSwitches: next };
    }),

  toggleOperation: (componentId, operationId) =>
    set((state) => {
      if (!state.running && !state.pathPreview) return {};
      const key = operationKey(componentId, operationId);
      const next = new Set(state.operatedDevices);
      if (!next.delete(key)) next.add(key);
      return { operatedDevices: next };
    }),

  evaluate: () => {
    const { running, pressedSwitches, operatedDevices, result } = get();

    if (!running) {
      stopTicking();
      if (result !== null) set({ result: null, nowMs: 0 });
      return;
    }

    const nowMs = performance.now() - startedAt;

    // 前回の励磁状態を必ず渡す。渡し忘れると自己保持回路が毎回解け、
    // ボタンを離した瞬間に落ちる（design.md §3.4 / §6-6）。
    // `previousTimers` も同じ性質で、渡し忘れるとタイマーの時間が進まない
    const next = simulate(
      useCircuitStore.getState().document,
      componentRegistry,
      {
        pressedSwitches,
        operatedDevices,
        previousEnergizedRelays: result?.energizedRelays,
        previousTimers: result?.timers,
        nowMs,
      },
    );
    set({ result: next, nowMs });

    /*
     * カウント中のタイマーがあるあいだだけ解き直しを回す。
     *
     * **`nextEventAtMs` の有無だけで判断する。** ここで「タイマーが置いてあるか」
     * を見ると、入力の入っていないタイマーを置いただけで回り続ける。
     */
    const counting = next.nextEventAtMs !== undefined;
    if (counting && tickHandle === null) {
      tickHandle = setInterval(() => {
        // 途中で停止された場合に備えて毎回確かめる（`stop()` でも止めているが、
        // 回路の差し替えなど別経路で running が落ちることがある）
        if (!get().running) {
          stopTicking();
          return;
        }
        get().evaluate();
      }, TICK_INTERVAL_MS);
    } else if (!counting) {
      stopTicking();
    }
  },
}));
