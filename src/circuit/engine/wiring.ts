/**
 * 電源を入れる前に分かる配線の誤り（design.md §5.7「静的な配線チェック」）。
 *
 * ▶ を押すまで何の指摘も出さないのは、**「実機を配線する前に確認する」という
 * このプロダクトの目的からするとひとつ遅い。** 未接続の端子も、還流ダイオードの
 * 逆挿しも、電源の直結も、通電させる前から配線図の上で決まっている。
 *
 * ここが解くのは **静止状態** —— どのスイッチも操作されておらず、どのリレーも
 * 励磁していない状態 —— の 1 パスだけ。収束ループを回さないので `simulate()` とは
 * 別物で、状態を持たず、`SimulationResult` も作らない。
 *
 * **含めないもの**
 *
 * - `oscillating` / `not-converged` —— 収束の結果そのものについての指摘であり、
 *   反復を回さないここには存在しない
 * - `coil-polarity-reversed` —— 極性の判定（`evaluateCoil`）は「コイルの両端に
 *   かかっている電位」で定義されている。静止状態では接点の向こう側のコイルに
 *   電位が届かず、**同じ誤配線が出たり出なかったりする。** 出方が安定しない指摘は
 *   「出なかった＝正しい」と読まれるぶん害があるので、▶ の診断に任せる
 *
 * **指摘が無いことは配線が正しいことを意味しない。** ボタンを押して初めて成立する
 * 短絡はここには出ない。UI 側でそう言い切ること（§8.4）。
 *
 * このファイルは React / Zustand / React Flow を import しない（CLAUDE.md 設計原則 1）。
 */

import type {
  CircuitDocument,
  ComponentDefinitionRegistry,
  SimulationInput,
  Warning,
} from "@/circuit/types";

import { buildNets, computeNetStates, type NetLookup } from "./graph";
import {
  detectDiodeOrientation,
  detectPowerShortCircuits,
  detectUnconnectedTerminals,
} from "./validation";

/** 静止状態の入力。どのスイッチも操作していない */
const AT_REST: SimulationInput = { pressedSwitches: new Set() };

/** 静止状態の励磁集合。どのリレーも励磁していない */
const NONE_ENERGIZED: ReadonlySet<string> = new Set();

/**
 * 静止状態の回路を 1 回だけ解き、配線そのものの誤りを返す。
 *
 * 並びは `simulate()` の警告と揃える（重い順ではなく検出順。並べ替えは
 * `lib/warning-display.ts` の仕事）。
 */
export const inspectWiring = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
): Warning[] => {
  const nets = buildNets(document, definitions, AT_REST, NONE_ENERGIZED);
  const netState = computeNetStates(document, definitions, nets);
  const lookup: NetLookup = { netOf: nets.netOf, netState };

  return [
    // B 接点や端子台を通って静止状態で + と 0V が繋がっているなら、
    // それは通電の有無に関係なく配線の誤り
    ...detectPowerShortCircuits(document, definitions, lookup),
    // 還流ダイオードの向きは「コイルと並列に、どちら向きに入っているか」で
    // 決まる。`validation.ts` が明言しているとおり通電の有無を見ない
    ...detectDiodeOrientation(document, definitions, lookup),
    // 配線に現れない端子。ネットすら見ない純粋に静的な指摘
    ...detectUnconnectedTerminals(document, definitions),
  ];
};
