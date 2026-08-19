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
  DimmerSettings,
  ElectricalDefinition,
  AnalogCurve,
} from "@/circuit/types";
import {
  analogInputKey,
  EMPTY_ANALOG_RESULT,
  fadeKey,
  terminalKey,
} from "@/circuit/types";

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

/** チャンネル 1 本が出す電圧。インスタンスの設定を先に見る */
export const channelVoltsOf = (
  source: Extract<ElectricalDefinition, { kind: "analog-source" }>,
  channelId: string,
  channelVolts: Readonly<Record<string, number>> | undefined,
): number => outputVoltsOf(source, channelVolts?.[channelId]);

/**
 * インスタンスの設定を当てたあとの変換規則（design.md §4.15）。
 *
 * **極性の反転は両端の入れ替えだけ。** エンジンは「どちらが全灯か」を
 * 知らないまま、実機の DIP と同じことをする（CLAUDE.md 設計原則 9）。
 */
export const effectiveCurve = (
  curve: AnalogCurve,
  settings: DimmerSettings | undefined,
): AnalogCurve =>
  settings?.inverted
    ? {
        ...curve,
        percentAtMin: curve.percentAtMax,
        percentAtMax: curve.percentAtMin,
      }
    : curve;

/**
 * カーブの形と上下限を当てる（design.md §4.15）。
 *
 * 順は **形 → 上下限 → DIRECT**。DIRECT を最後に置くのは、実機の直点が
 * 上限設定すら飛び越えて全点灯するため —— 先に丸めると
 * 「DIRECT にしたのに 70% までしか上がらない」という嘘になる。
 *
 * 遮断（`cutoff`）はここでは扱わない。呼び出し側が 0% を返す。
 */
export const shapePercent = (
  percent: number,
  settings: DimmerSettings | undefined,
): number => {
  if (settings?.direct) return 100;

  // 2 乗特性。低いほうが緩やかに効く（実機の「２乗特性」）
  const shaped =
    settings?.curveShape === "square" ? (percent * percent) / 100 : percent;

  const min = settings?.minPercent ?? 0;
  const max = settings?.maxPercent ?? 100;
  // 下限が上限を超える設定でも壊さない。狭いほうへ倒す
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return Math.min(Math.max(shaped, low), high);
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
 * **チャンネルごとに別の信号として畳む。** 実機の調光コントローラは
 * 0–10V を 16 回路持ち、回路ごとに違う電圧を出す。基準（コモン）は
 * 機器で 1 つなので、どのチャンネルも同じ基準ネットを指す。
 *
 * 信号ネットと基準ネットが**同じネット**なら（接点で 0V コモンへ落とした
 * "DIRECT"）、出力が何 V を出していようと 0V。基準に対する電圧が 0 なのだから
 * 特別扱いではなく、ネットの形からそのまま出る答えになっている。
 */
const collectSignals = (
  placed: readonly Placed[],
  netOf: ReadonlyMap<string, number>,
  effectiveVolts: ReadonlyMap<string, number>,
): Map<number, AnalogSignal> => {
  const signals = new Map<number, AnalogSignal>();

  for (const { instance, definition } of placed) {
    const { electrical } = definition;
    if (electrical.kind !== "analog-source") continue;

    // コモンは機器内部で繋がっているので、どの端子から引いても同じネット。
    // 1 本でも見つかればよい（未配線の予備 GND があっても止まらない）
    let referenceNet: number | undefined;
    for (const common of electrical.commonTerminals) {
      const net = netOf.get(terminalKey(instance.id, common));
      if (net !== undefined) {
        referenceNet = net;
        break;
      }
    }
    if (referenceNet === undefined) continue;

    for (const channel of electrical.channels) {
      const signalNet = netOf.get(
        terminalKey(instance.id, channel.signalTerminal),
      );
      if (signalNet === undefined) continue;

      const pulledToReference = signalNet === referenceNet;
      /*
       * **フェード中はここが目標値ではなく途中の電圧になる**（design.md §5.18）。
       * 呼び出し側が渡してこなければ目標値のまま —— 停止中の配線チェックや
       * 経路確認モードには時間が無く、そこで途中の値を出す意味が無い。
       *
       * **`pulledToReference`（DIRECT）はフェードより先に効く。** 接点で
       * 0V コモンへ落とすのは機器の外の短絡で、出力段を通らないので瞬時。
       */
      const outputVolts =
        effectiveVolts.get(fadeKey(instance.id, channel.id)) ??
        channelVoltsOf(electrical, channel.id, instance.channelVolts);
      const signal: AnalogSignal = {
        volts: pulledToReference ? 0 : outputVolts,
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
  }

  return signals;
};

/**
 * 調光信号を受ける入力段の共通の形。
 *
 * **調光ランプ（`dimming`）と位相制御調光器（`kind: "dimmer"`）で
 * 同じ 1 本を使う。** 受け側の事情は「どの端子で受けるか・どう %へ
 * 直すか・未接続なら何 V か」しかなく、自分が点るか他人を暗くするかは
 * 入力段の話ではない。分けると基準の突き合わせを 2 箇所に書くことになる。
 */
type AnalogInput = {
  signalTerminal: string;
  commonTerminal: string;
  curve: AnalogCurve;
  unconnectedVolts: number;
};

/**
 * 入力段 1 個の解。
 *
 * 判定の順は「信号が来ているか」→「基準が共通か」→「レベル」。
 *
 * **基準が共通でない信号は成立しない**（design.md §5.3 の
 * `supplyMismatch` とまったく同じ話）。0–10V は基準に対する電圧なので、
 * リターンが共通でないと電圧そのものが意味を持たない。成立しない以上、
 * 入力段は未接続と同じ状態にある —— だから `unconnectedVolts` へ落とす。
 * **0V = 100% の仕様では、これも全灯になる。**
 */
const inputLevel = (
  input: AnalogInput,
  settings: DimmerSettings | undefined,
  componentId: string,
  netOf: ReadonlyMap<string, number>,
  signals: ReadonlyMap<number, AnalogSignal>,
): DimmingLevel => {
  const curve = effectiveCurve(input.curve, settings);
  const at = (volts: number, floating: boolean, referenceMismatch: boolean) => ({
    volts,
    percent: shapePercent(analogPercent(curve, volts), settings),
    floating,
    referenceMismatch,
    cutOff: false,
  });

  const signalNet = netOf.get(terminalKey(componentId, input.signalTerminal));
  const commonNet = netOf.get(terminalKey(componentId, input.commonTerminal));
  const signal = signalNet === undefined ? undefined : signals.get(signalNet);

  // 信号が届いていない。未接続時のレベルは定義が持つ（エンジンは決め打ちしない）
  if (!signal) return at(input.unconnectedVolts, true, false);

  if (commonNet === undefined || commonNet !== signal.referenceNet) {
    return at(input.unconnectedVolts, true, true);
  }

  return at(signal.volts, false, false);
};

/**
 * 位相制御調光器 1 台の解（design.md §4.15）。
 *
 * **遮断が最優先。** 遮断端子が信号の基準と同じネットにあれば、信号が
 * 何 V でも・DIRECT でも 0%。実機の「強制出力遮断」は調光段より後ろで
 * 切っているので、前段の設定では戻らない。
 */
const dimmerLevel = (
  electrical: Extract<ElectricalDefinition, { kind: "dimmer" }>,
  instance: CircuitComponentInstance,
  netOf: ReadonlyMap<string, number>,
  signals: ReadonlyMap<number, AnalogSignal>,
): DimmingLevel => {
  const cutoffNet = netOf.get(terminalKey(instance.id, electrical.cutoffTerminal));
  const commonNet = netOf.get(
    terminalKey(instance.id, electrical.signalCommonTerminal),
  );
  const level = inputLevel(
    {
      signalTerminal: electrical.signalTerminal,
      commonTerminal: electrical.signalCommonTerminal,
      curve: electrical.curve,
      unconnectedVolts: electrical.unconnectedVolts,
    },
    instance.dimmerSettings,
    instance.id,
    netOf,
    signals,
  );

  const cutOff =
    cutoffNet !== undefined && commonNet !== undefined && cutoffNet === commonNet;
  return cutOff ? { ...level, percent: 0, cutOff: true } : level;
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
  /**
   * フェードで動いている途中の出力電圧（`fadeKey()` → V・design.md §5.18）。
   *
   * **省略できるのが要点。** 停止中の配線チェック（`inspectWiring`）・
   * 役割配色（`wire-role.ts`）・経路確認モード（`path-preview.ts`）には
   * 時間が流れていないので、渡さなければ今までどおり目標値で解ける。
   * フェードのためにこの 3 つを書き換えずに済む。
   */
  effectiveVolts: ReadonlyMap<string, number> = new Map(),
): AnalogResult => {
  const placed = placedComponents(document, definitions);
  const signals = collectSignals(placed, netOf, effectiveVolts);

  const levels = new Map<string, DimmingLevel>();
  const netLevels = new Map<number, DimmingLevel>();

  // ① 調光器。出力回路のネットに明るさを乗せる
  for (const { instance, definition } of placed) {
    const { electrical } = definition;
    if (electrical.kind !== "dimmer") continue;
    const level = dimmerLevel(electrical, instance, netOf, signals);
    levels.set(instance.id, level);

    const outNet = netOf.get(terminalKey(instance.id, electrical.outTerminal));
    if (outNet === undefined) continue;
    // 同じ回路に 2 台ぶら下がっていたら暗いほうが勝つ。信号どうしの
    // 突き合わせ（`strongerOf`）と同じ「引き下げが勝つ」規則で揃える
    const existing = netLevels.get(outNet);
    if (!existing || level.percent < existing.percent) {
      netLevels.set(outNet, level);
    }
  }

  // ② ランプ。自分の調光入力が最優先で、無ければ乗っている回路の明るさ
  for (const { instance, definition } of placed) {
    const { electrical } = definition;
    if (electrical.kind !== "lamp") continue;

    if (electrical.dimming) {
      levels.set(
        instance.id,
        inputLevel(
          electrical.dimming,
          instance.dimmerSettings,
          instance.id,
          netOf,
          signals,
        ),
      );
      continue;
    }

    if (netLevels.size === 0) continue;
    for (const terminal of [electrical.terminalA, electrical.terminalB]) {
      const net = netOf.get(terminalKey(instance.id, terminal));
      const level = net === undefined ? undefined : netLevels.get(net);
      if (level) {
        levels.set(instance.id, level);
        break;
      }
    }
  }

  /*
   * ③ 接点を動かすために受けている調光入力（カットリレー・design.md §4.16）。
   *
   * **`levelOf` には入れない。** カットリレーは自分が点るわけでも暗くなる
   * わけでもなく、受けた明るさで接点を動かすだけ。混ぜると部品一覧に
   * 「明るさ」の無い機器の明るさが並ぶ。
   */
  const inputLevels = new Map<string, DimmingLevel>();
  for (const { instance, definition } of placed) {
    const { electrical } = definition;
    if (electrical.kind !== "relay") continue;
    for (const input of electrical.relay.analogInputs ?? []) {
      inputLevels.set(
        analogInputKey(instance.id, input.id),
        inputLevel(
          input,
          instance.dimmerSettings,
          instance.id,
          netOf,
          signals,
        ),
      );
    }
  }

  if (signals.size === 0 && levels.size === 0 && inputLevels.size === 0) {
    return EMPTY_ANALOG_RESULT;
  }
  return {
    signalOf: signals,
    levelOf: levels,
    netLevelOf: netLevels,
    inputLevelOf: inputLevels,
  };
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
