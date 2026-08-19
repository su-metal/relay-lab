/**
 * 収束ループ（design.md §5.5）。エンジンのエントリポイント。
 *
 * リレー回路は「接点の状態がコイルを決め、コイルが接点を決める」相互依存なので、
 * 一度グラフを解くだけでは答えが出ない。励磁状態を仮に置いてグラフを解き直す、
 * を状態が変わらなくなるまで繰り返す（不動点反復）。
 *
 * このファイルは React / Zustand / React Flow を import しない（CLAUDE.md 設計原則 1）。
 */

import type {
  AnalogResult,
  CircuitDocument,
  ComponentDefinitionRegistry,
  NetState,
  SimulationInput,
  SimulationResult,
  SimulationStatus,
  TimerState,
  Warning,
} from "@/circuit/types";
import { MAX_ITERATIONS } from "@/lib/app-info";

import { resolveAnalog } from "./analog";
import { detectSelfInterruptingCoils } from "./chatter";
import {
  buildNets,
  computeNetStates,
  stateAt,
  type NetAssignment,
  type NetLookup,
  type OperatedContacts,
} from "./graph";
import { polarityAcross } from "./potential";
import { evaluateCoil, operatedContactsOf } from "./relay";
import {
  advanceTimer,
  presetMsOf,
  timerNextEventAtMs,
  timerOutputOn,
} from "./timer";
import {
  describeComponent,
  detectAnalogReferenceMismatch,
  detectDiodeOrientation,
  detectPowerShortCircuits,
  detectUnconnectedTerminals,
  statusWarnings,
} from "./validation";

/** 励磁状態の集合を比較用の文字列にする。発振検出の履歴キーにも使う */
const signature = (relays: ReadonlySet<string>): string =>
  [...relays].sort().join("|");

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
};

/**
 * 動作している接点の集合を比較用の文字列にする（design.md §4.16）。
 *
 * `signature()` と同じ役割で、こちらは接点ごとに見る。**発振の検出に
 * 要る** —— アナログ量で動く接点が自分の明るさを変える配線
 * （調光信号を自分の接点で切り替える等）は、コイルの自励発振と同じ
 * 周期に入りうる。
 */
const operatedSignature = (operated: OperatedContacts): string =>
  [...operated]
    .map(([componentId, contacts]) => `${componentId}:${[...contacts].sort().join(",")}`)
    .sort()
    .join("|");

const sameOperated = (a: OperatedContacts, b: OperatedContacts): boolean =>
  operatedSignature(a) === operatedSignature(b);

type RelayEvaluation = {
  /**
   * **接点が切り替わっている**部品。遅延なしのリレーはコイルの励磁と一致するが、
   * タイマーは限時のぶんずれる（design.md §5.13）。`buildNets()` が見るのはこちら
   */
  energized: Set<string>;
  /** タイマーの実行時状態。次回の `previousTimers` になる */
  timers: Map<string, TimerState>;
  warnings: Warning[];
};

/**
 * 全リレーのコイルを一斉に評価する。接点の状態は評価中に変えない（同時性の担保）。
 *
 * タイマー（`delay` を持つリレー）は、コイルの励磁をそのまま接点に流さず
 * `timer.ts` を通す。**`previousTimers` は 1 回の `simulate()` の中で固定** ——
 * 収束の反復ごとに更新すると `changedAtMs` が毎回打ち直されて時間が進まない。
 */
const evaluateRelays = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
  lookup: NetLookup,
  nowMs: number,
  previousTimers: ReadonlyMap<string, TimerState>,
): RelayEvaluation => {
  const energized = new Set<string>();
  const timers = new Map<string, TimerState>();
  const warnings: Warning[] = [];

  for (const instance of document.components) {
    const definition = definitions.get(instance.definitionId);
    if (!definition) continue;
    const { electrical } = definition;
    if (electrical.kind !== "relay") continue;

    const { coil } = electrical.relay;
    const evaluation = evaluateCoil(
      coil,
      coil && stateAt(lookup, instance.id, coil.positiveTerminal),
      coil && stateAt(lookup, instance.id, coil.negativeTerminal),
    );

    if (electrical.delay) {
      const state = advanceTimer(
        previousTimers.get(instance.id),
        evaluation.energized,
        nowMs,
      );
      timers.set(instance.id, state);
      const preset = presetMsOf(electrical.delay, instance.presetMs);
      if (timerOutputOn(electrical.delay, state, preset, nowMs)) {
        energized.add(instance.id);
      }
    } else if (evaluation.energized) {
      energized.add(instance.id);
    }

    if (evaluation.reversed && coil) {
      const name = describeComponent(instance, definition);
      warnings.push({
        code: "coil-polarity-reversed",
        severity: coil.polarity === "strict" ? "error" : "warning",
        message:
          coil.polarity === "strict"
            ? `${name} のコイルの極性が逆です。内蔵ダイオードが順方向になるため励磁しません。`
            : `${name} のコイルの極性が逆です（励磁はしますが表示灯が点灯しません）。`,
        componentId: instance.id,
        terminalId: coil.positiveTerminal,
      });
    }
  }

  return { energized, timers, warnings };
};

/**
 * 点灯しているランプを求める。
 *
 * ランプは負荷なのでグラフ上で union されていない（design.md §5.2）。
 * 「両端が異なる電源ネットに属するか」だけが点灯条件で、極性は問わない。
 *
 * **調光ランプでも点灯条件は同じ。** 違うのは、電源が来ていても
 * 明るさが 0% なら光っていないという 1 点だけ（design.md §5.17）。
 * 調光を持たないランプはこの追加条件を通らない（`level` が無い）。
 */
const collectLitLamps = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
  lookup: NetLookup,
  analog: AnalogResult,
): Set<string> => {
  const lit = new Set<string>();

  for (const instance of document.components) {
    const definition = definitions.get(instance.definitionId);
    if (!definition) continue;
    const { electrical } = definition;
    if (electrical.kind !== "lamp") continue;

    const across = polarityAcross(
      stateAt(lookup, instance.id, electrical.terminalA),
      stateAt(lookup, instance.id, electrical.terminalB),
    );
    if (across === "none") continue;

    const level = analog.levelOf.get(instance.id);
    if (level && level.percent <= 0) continue;
    lit.add(instance.id);
  }

  return lit;
};

/** 1 回の反復で得られた状態のスナップショット */
type Iteration = {
  /** このグラフを組み立てるのに使った切替状態 */
  energized: ReadonlySet<string>;
  /** 同じく、コイル以外の駆動源で動いていた接点（design.md §4.16） */
  operatedContacts: OperatedContacts;
  nets: NetAssignment;
  /** このネットに対応するアナログ層の解（design.md §5.17） */
  analog: AnalogResult;
  netState: Map<number, NetState>;
  coilWarnings: Warning[];
  timers: Map<string, TimerState>;
};

/**
 * カウント中のタイマーのうち、次に接点が変わる最も早い時刻（design.md §5.13）。
 *
 * ストアが「まだ時計を進める必要があるか」を判断する唯一の手がかり。
 * タイマーが 1 個も無い回路では `undefined` になり、再計算のループは回らない。
 */
const nextEventOf = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
  timers: ReadonlyMap<string, TimerState>,
  nowMs: number,
): number | undefined => {
  let earliest: number | undefined;

  for (const instance of document.components) {
    const electrical = definitions.get(instance.definitionId)?.electrical;
    if (electrical?.kind !== "relay" || !electrical.delay) continue;
    const state = timers.get(instance.id);
    if (!state) continue;

    const at = timerNextEventAtMs(
      electrical.delay,
      state,
      presetMsOf(electrical.delay, instance.presetMs),
      nowMs,
    );
    if (at !== undefined && (earliest === undefined || at < earliest)) {
      earliest = at;
    }
  }

  return earliest;
};

/**
 * 回路を解く。
 *
 * @param input.previousEnergizedRelays 直前の励磁状態。自己保持回路の再現に必須
 * @param input.previousTimers 直前のタイマー状態。**渡し忘れると時間が進まない**
 *   （毎回「今この瞬間に入力が入った」ところからやり直すため・design.md §5.13）
 * @param input.nowMs 開始からの経過ミリ秒。省略時は 0
 */
export const simulate = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
  input: SimulationInput,
): SimulationResult => {
  // 前回の励磁状態から始める。全 OFF から解き直すと、自己保持回路は
  // ボタンを離した瞬間に全 OFF（これも安定解）へ落ちてしまう
  let energized: ReadonlySet<string> = new Set(
    input.previousEnergizedRelays ?? [],
  );
  /*
   * コイル以外の駆動源で動く接点（design.md §4.16）。
   *
   * **初期値は空。** 自己保持のような双安定性はここには無い ——
   * アナログ量も人の操作も、そのときのネットと入力から一意に決まる。
   */
  let operatedContacts: OperatedContacts = new Map();
  const history: string[] = [];

  const nowMs = input.nowMs ?? 0;
  /*
   * **収束ループの中では固定する。** 反復のたびに更新すると、途中経過で
   * `changedAtMs` が打ち直されて経過時間が常に 0 になり、設定時間へ到達しない。
   * 時間が進むのは `simulate()` の呼び出しをまたいだときだけ。
   */
  const previousTimers = input.previousTimers ?? new Map<string, TimerState>();

  let status: SimulationStatus = "not-converged";
  let iterations = 0;
  let last: Iteration | undefined;

  while (iterations < MAX_ITERATIONS) {
    iterations += 1;

    const nets = buildNets(
      document,
      definitions,
      input,
      energized,
      undefined,
      operatedContacts,
    );
    const netState = computeNetStates(document, definitions, nets);
    const lookup: NetLookup = { netOf: nets.netOf, netState };
    const relays = evaluateRelays(
      document,
      definitions,
      lookup,
      nowMs,
      previousTimers,
    );
    /*
     * **アナログを反復の中で解く（Step 22 で変更）。**
     *
     * §5.17 は当初「アナログ量は接点を動かさないので収束ループの中には
     * 入れない」としていた。カットリレー（design.md §4.16）がこれを崩す ——
     * 明るさが接点を動かし、接点がネットの形を変え、ネットの形が明るさを
     * 決める。コイルと接点の相互依存とまったく同じ構造なので、同じ
     * 不動点反復で解く。
     *
     * **層の分け方は変えていない。** `NetState` に電圧は混ざらず、
     * アナログは今もネットの上に重ねる第 2 パスのまま。変わったのは
     * 解く順番だけ（CLAUDE.md 設計原則 9）。
     */
    const analog = resolveAnalog(document, definitions, nets.netOf);
    const nextOperated = operatedContactsOf(
      document,
      definitions,
      analog,
      input.operatedDevices,
    );

    last = {
      energized,
      operatedContacts,
      nets,
      netState,
      analog,
      coilWarnings: relays.warnings,
      timers: relays.timers,
    };

    if (
      sameSet(relays.energized, energized) &&
      sameOperated(nextOperated, operatedContacts)
    ) {
      status = "stable";
      break;
    }

    const key = `${signature(relays.energized)}#${operatedSignature(nextOperated)}`;
    if (history.includes(key)) {
      // 同じ状態が再出現した＝周期に入った。反復上限とは区別する（design.md §5.5）
      status = "oscillating";
      break;
    }
    history.push(key);
    energized = relays.energized;
    operatedContacts = nextOperated;
  }

  // MAX_ITERATIONS が 1 以上である限り last は必ず入る
  if (!last) {
    throw new Error("収束ループが 1 回も実行されませんでした");
  }

  const lookup: NetLookup = { netOf: last.nets.netOf, netState: last.netState };

  /*
   * アナログ層は**反復の中で解いたものをそのまま使う**（design.md §5.17）。
   * カットリレーが接点を動かす以上、収束したネットに対応する解でなければ
   * 「接点はこの明るさで動いたのに、画面に出る明るさは別」がありえる。
   */
  const analog = last.analog;

  const warnings: Warning[] = [
    ...detectPowerShortCircuits(document, definitions, lookup),
    ...detectDiodeOrientation(document, definitions, lookup),
    ...last.coilWarnings,
    /*
     * 収束した**あと**に 1 回だけ聞く。中間位置は安定状態ではないので
     * 反復の中で解くものではなく、確定した状態に対する後付けの検査になる
     * （design.md §5.14）
     */
    ...detectSelfInterruptingCoils(document, definitions, input, last.energized),
    ...detectAnalogReferenceMismatch(document, definitions, analog),
    ...statusWarnings(status),
    ...detectUnconnectedTerminals(document, definitions),
  ];

  return {
    energizedRelays: last.energized,
    operatedContacts: last.operatedContacts,
    timers: last.timers,
    nextEventAtMs: nextEventOf(document, definitions, last.timers, nowMs),
    litLamps: collectLitLamps(document, definitions, lookup, analog),
    analog,
    netOf: last.nets.netOf,
    netState: last.netState,
    warnings,
    status,
    iterations,
  };
};
