/**
 * アナログ量（0–10V の調光信号）の解決（design.md §5.17）。
 *
 * **導通レイヤは触らない。** ネットの分割（Union-Find）も `NetState`
 * （どの電源の + / 0V に届くか）もそのままで、組み終わったネットの上に
 * 電圧値を**第 2 パスとして重ねる。** ダイオード（`diode.ts`）が DSU を
 * 変えずに電位を一方向へ流しているのと同じ場所・同じ手口で、
 * 負荷を union しない原則（CLAUDE.md 設計原則 3）にも触れない。
 *
 * 重ねる側にした理由は 3 つあり、どれも「混ぜると壊れる」ことに尽きる。
 *
 * 1. **0V を出している調光信号線は電源の 0V ではない。** `NetState` に
 *    混ぜると電源短絡の判定（§5.7）と配線色（§5.6）に紛れ込み、
 *    **正しい配線が最も危険な警告で真っ赤になる**
 * 2. **0V = 100% の仕様では、0V の線こそ全灯している線。** 導通の配色に
 *    載せると `zero`（青）か `inactive`（灰）になり、
 *    **効いている線が効いていないように見える**（CLAUDE.md 設計原則 8 と
 *    同じ種類の事故）
 * 3. **接点で信号線を 0V へ落とす配線（実機盤の "DIRECT"）は既存の
 *    Union-Find がそのまま表している。** アナログのために別のグラフを
 *    作る必要が無い
 *
 * このファイルは型番を見ない（CLAUDE.md 設計原則 2）。逆特性（0V = 100%）は
 * ここではなく定義側の `AnalogCurve` が持ち、順特性の機器を足しても
 * この 1 枚は 1 行も変わらない。
 */

import type {
  AnalogResult,
  AnalogSignal,
  CircuitComponentInstance,
  CircuitDocument,
  ComponentDefinition,
  ComponentDefinitionRegistry,
  DimmingLevel,
  ElectricalDefinition,
  AnalogCurve,
} from "@/circuit/types";
import { EMPTY_ANALOG_RESULT, terminalKey } from "@/circuit/types";

/**
 * 調光出力が実際に出す電圧。範囲外は定義の上下限へ丸める。
 *
 * `presetMsOf`（タイマーの設定時間・§5.13）とまったく同じ形。
 * インスタンスの値を先に見て、無ければ定義の既定値を使う。
 */
export const outputVoltsOf = (
  source: Extract<ElectricalDefinition, { kind: "analog-source" }>,
  outputVolts: number | undefined,
): number => {
  const value =
    outputVolts === undefined || !Number.isFinite(outputVolts)
      ? source.defaultVolts
      : outputVolts;
  return Math.min(Math.max(value, source.minVolts), source.maxVolts);
};

/**
 * 電圧 → 明るさ（%）。**変換規則は定義側の宣言だけを読む。**
 *
 * 逆特性（`percentAtMin: 100` / `percentAtMax: 0`）でも順特性でも
 * 同じ 1 次補間で出る。範囲外の電圧は両端へ丸める —— 実機の入力段も
 * 上限を超えたぶんは効かない。
 */
export const analogPercent = (curve: AnalogCurve, volts: number): number => {
  const span = curve.maxVolts - curve.minVolts;
  // 上下端が同じ電圧の定義（幅ゼロ）は補間できない。下端の値を返す
  if (span === 0) return curve.percentAtMin;
  const ratio = (volts - curve.minVolts) / span;
  const clamped = Math.min(Math.max(ratio, 0), 1);
  return curve.percentAtMin + (curve.percentAtMax - curve.percentAtMin) * clamped;
};

/** 定義とインスタンスの組。両方を一度に引き回すための最小の型 */
type Placed = {
  instance: CircuitComponentInstance;
  definition: ComponentDefinition;
};

const placedComponents = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
): Placed[] => {
  const placed: Placed[] = [];
  for (const instance of document.components) {
    const definition = definitions.get(instance.definitionId);
    if (definition) placed.push({ instance, definition });
  }
  return placed;
};

/**
 * 同じネットを複数の調光出力が駆動したときの勝ち方。**低いほうが勝つ。**
 *
 * 実機で 2 つの出力段を並列に繋ぐのは本来やってはいけない配線だが、
 * この規則には根拠がある —— 接点で 0V コモンへ落とす "DIRECT"（全灯）は
 * まさに「外から引き下げる」操作で、**引き下げが勝つ**という同じ 1 つの
 * 規則の極端な場合になる。出力段のインピーダンスはモデル化しないので、
 * 「どちらが強いか」をこれ以上細かく決める材料が無い（requirements.md ⑥）。
 */
const strongerOf = (a: AnalogSignal, b: AnalogSignal): AnalogSignal =>
  b.volts < a.volts ? b : a;

/**
 * 回路中の調光出力を、信号ネットごとの電圧に畳む。
 *
 * 信号ネットと基準ネットが**同じネット**なら（接点で 0V コモンへ落とした
 * "DIRECT"）、出力が何 V を出していようと 0V。基準に対する電圧が 0 なのだから
 * 特別扱いではなく、ネットの形からそのまま出る答えになっている。
 */
const collectSignals = (
  placed: readonly Placed[],
  netOf: ReadonlyMap<string, number>,
): Map<number, AnalogSignal> => {
  const signals = new Map<number, AnalogSignal>();

  for (const { instance, definition } of placed) {
    const { electrical } = definition;
    if (electrical.kind !== "analog-source") continue;

    const signalNet = netOf.get(
      terminalKey(instance.id, electrical.signalTerminal),
    );
    const referenceNet = netOf.get(
      terminalKey(instance.id, electrical.commonTerminal),
    );
    if (signalNet === undefined || referenceNet === undefined) continue;

    const pulledToReference = signalNet === referenceNet;
    const signal: AnalogSignal = {
      volts: pulledToReference
        ? 0
        : outputVoltsOf(electrical, instance.outputVolts),
      referenceNet,
      sourceIds: [instance.id],
      pulledToReference,
    };

    const existing = signals.get(signalNet);
    if (!existing) {
      signals.set(signalNet, signal);
      continue;
    }
    const winner = strongerOf(existing, signal);
    signals.set(signalNet, {
      ...winner,
      // 「誰が出しているか」は警告文に要るので、負けた側の ID も残す
      sourceIds: [...existing.sourceIds, ...signal.sourceIds],
      pulledToReference:
        existing.pulledToReference || signal.pulledToReference,
    });
  }

  return signals;
};

/**
 * 調光入力を持つ負荷 1 個の解。
 *
 * 判定の順は「信号が来ているか」→「基準が共通か」→「レベル」。
 *
 * **基準が共通でない信号は成立しない**（design.md §5.3 の
 * `supplyMismatch` とまったく同じ話）。0–10V は基準に対する電圧なので、
 * リターンが共通でないと電圧そのものが意味を持たない。成立しない以上、
 * 入力段は未接続と同じ状態にある —— だから `unconnectedVolts` へ落とす。
 * **0V = 100% の仕様では、これも全灯になる。**
 */
const levelOf = (
  electrical: Extract<ElectricalDefinition, { kind: "lamp" }>,
  componentId: string,
  netOf: ReadonlyMap<string, number>,
  signals: ReadonlyMap<number, AnalogSignal>,
): DimmingLevel | undefined => {
  const dimming = electrical.dimming;
  if (!dimming) return undefined;

  const signalNet = netOf.get(terminalKey(componentId, dimming.signalTerminal));
  const commonNet = netOf.get(terminalKey(componentId, dimming.commonTerminal));

  const signal = signalNet === undefined ? undefined : signals.get(signalNet);

  // 信号が届いていない。未接続時のレベルは定義が持つ（エンジンは決め打ちしない）
  if (!signal) {
    return {
      volts: dimming.unconnectedVolts,
      percent: analogPercent(dimming.curve, dimming.unconnectedVolts),
      floating: true,
      referenceMismatch: false,
    };
  }

  if (commonNet === undefined || commonNet !== signal.referenceNet) {
    return {
      volts: dimming.unconnectedVolts,
      percent: analogPercent(dimming.curve, dimming.unconnectedVolts),
      floating: true,
      referenceMismatch: true,
    };
  }

  return {
    volts: signal.volts,
    percent: analogPercent(dimming.curve, signal.volts),
    floating: false,
    referenceMismatch: false,
  };
};

/**
 * アナログ層を解く。ネットを組み終わった**あと**に 1 回だけ呼ぶ。
 *
 * 収束ループ（§5.5）の中には入れない。**アナログ量は接点を動かさない** ——
 * 調光レベルが変わってもリレーは励磁せず、ネットの形も変わらないので、
 * 反復の中で解き直す理由が無い（ダイオードの伝搬と違い、こちらは
 * 導通の答えにまったく影響しない）。
 */
export const resolveAnalog = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
  netOf: ReadonlyMap<string, number>,
): AnalogResult => {
  const placed = placedComponents(document, definitions);
  const signals = collectSignals(placed, netOf);

  const levels = new Map<string, DimmingLevel>();
  for (const { instance, definition } of placed) {
    const { electrical } = definition;
    if (electrical.kind !== "lamp") continue;
    const level = levelOf(electrical, instance.id, netOf, signals);
    if (level) levels.set(instance.id, level);
  }

  if (signals.size === 0 && levels.size === 0) return EMPTY_ANALOG_RESULT;
  return { signalOf: signals, levelOf: levels };
};

/**
 * アナログ信号が乗っているネット ID（design.md §5.6・§5.17）。
 *
 * 含めるのは信号側のネットだけで、基準側は入れない —— 基準線は電源の 0V と
 * 同じ意味を持つ普通の線であり、専用色にする理由が無い。
 *
 * **電源に届いているネットをここで除かないのは、判定順が受け持つため。**
 * 接点で 0V コモンへ落とした信号線（"DIRECT"）は、コモンを電源の 0V に
 * 繋いでいれば**本当に電源の 0V 線**になっている。そこを専用色で塗るのは
 * 嘘なので、`wireStateOfNet` / `roleAt` は `plus` / `zero` を先に見て、
 * どちらでもないときにだけこの集合を引く。結果としてアナログ色が付くのは
 * 「導通の配色では灰（非通電）にしかならないが、実際には効いている線」だけになる。
 */
export const analogSignalNets = (analog: AnalogResult): ReadonlySet<number> =>
  new Set(analog.signalOf.keys());
