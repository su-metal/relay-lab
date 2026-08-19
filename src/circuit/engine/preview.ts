/**
 * 静止状態の到達範囲（design.md §5.15「経路確認」）。
 *
 * ▶ を押す前に「電源からどこまで電位が届いていて、**どこで止まっているか**」を
 * 返す。実機を配線する前に確認する、というこのプロダクトの目的からすると、
 * 経路が読めるのが実行中だけなのはひとつ遅い。
 *
 * **停止中の役割配色（§5.8・`adapter/wire-role.ts`）とは問いが違う。** あちらは
 * 「この線はいつか電源につながるか」（3 通りのネットを見た静的な役割）で、
 * 接点の先の線をまとめて制御線＝黄にする。ここが答えるのは
 * 「**今この瞬間**どこまで来ているか」で、その黄を「届いている / まだ届かない」に
 * 割る。片方だけでは分からないものが両方にあるので、どちらも残す。
 *
 * 解くのは **1 パスだけ**（`wiring.ts` と共有）。収束ループを回さないので
 * `simulate()` とは別物で、状態を持たず `SimulationResult` も作らない。
 *
 * **スイッチは操作できるが、リレーは動かない**（design.md §5.15）。スイッチは
 * 人が倒すもので、倒した結果は回路を解かなくても決まっているから 1 パスのまま
 * 扱える。リレーを動かすと「動いた接点で別のリレーが動く」の連鎖になり、
 * それは収束ループ＝▶ の領分になる。**この境目がこのファイルの存在理由**で、
 * ここを踏み越えると「時間の進まない ▶」が二重に育つ。
 *
 * このファイルは React / Zustand / React Flow を import しない（CLAUDE.md 設計原則 1）。
 * 時計も読まない —— 静止状態にはタイマーの経過という概念が無い。
 */

import type {
  CircuitDocument,
  ComponentDefinitionRegistry,
  NetState,
  SimulationInput,
} from "@/circuit/types";

import {
  AT_REST,
  NONE_ENERGIZED,
  openPairs,
  solveWithoutRelays,
  stateAt,
} from "./graph";
import {
  polarityAcross,
  reachesPlus,
  reachesZero,
  spansSupply,
} from "./potential";
import { evaluateCoil } from "./relay";

/**
 * 電位が止まっている 1 箇所。**この機能の主役。**
 *
 * 「+ 側は S1 の 3 番まで来ているが、S1 が開いているのでその先へ行かない」を
 * 端子番号で言えるようにするための組。`fedTerminalId` と `blockedTerminalId` は
 * **同じ部品の中で開いている 2 端子**で、閉じれば繋がる。
 */
export type PreviewBlocker = {
  componentId: string;
  /** 電位が届いている側の端子 */
  fedTerminalId: string;
  /** その先の、まだ届いていない端子 */
  blockedTerminalId: string;
  /** 届いているのが電源のどちら側か */
  side: "plus" | "zero";
};

/**
 * 1 パスの解。
 *
 * `SimulationResult` にはしない。**`warnings` も `status` も `iterations` も
 * 持たないものを同じ型で名乗ると、受け取った側が「収束した結果」として扱う。**
 * 収束させていないという事実を型で残す（`wiring.ts` が `SimulationResult` を
 * 作らないのと同じ理由）。
 */
export type PathPreview = {
  /** `terminalKey()` → ネット ID */
  netOf: ReadonlyMap<string, number>;
  /** ネット ID → 電位状態 */
  netState: ReadonlyMap<number, NetState>;
  /**
   * この状態でコイルに電位差がかかっているリレー。
   *
   * **`energizedRelays`（接点が切り替わっている）ではなくコイルの側。**
   * 経路確認では**接点は動かない**ので、ここが埋まっていても相手の接点は開いたまま。
   * タイマーは静止状態でも「コイルは入っているが接点はまだ」の位置に
   * 立ちうるので、接点で見ると計測を始めるはずのコイル配線が灰色になる
   * （CLAUDE.md 設計原則 8・design.md §5.13）。
   */
  energizedCoils: ReadonlySet<string>;
  /** この状態で点灯するランプ */
  litLamps: ReadonlySet<string>;
  /** 電位が止まっている箇所。部品の並び順 */
  blockers: readonly PreviewBlocker[];
};

/**
 * この状態で負荷が成立しているかを集める。
 *
 * 判定規則は `simulate()` と同じものを使い回す（`evaluateCoil` /
 * `polarityAcross`）。**ここに独自の判定を書くと、経路確認では励磁すると
 * 出ているのに ▶ を押すと励磁しない、という食い違いが起きる。**
 */
const collectActiveLoads = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
  lookup: { netOf: ReadonlyMap<string, number>; netState: ReadonlyMap<number, NetState> },
): { energizedCoils: Set<string>; litLamps: Set<string> } => {
  const energizedCoils = new Set<string>();
  const litLamps = new Set<string>();

  for (const instance of document.components) {
    const definition = definitions.get(instance.definitionId);
    if (!definition) continue;
    const { electrical } = definition;

    if (electrical.kind === "relay") {
      const { coil } = electrical.relay;
      // コイルが無ければ電位では動かない（design.md §4.16）
      if (!coil) continue;
      const evaluation = evaluateCoil(
        coil,
        stateAt(lookup, instance.id, coil.positiveTerminal),
        stateAt(lookup, instance.id, coil.negativeTerminal),
      );
      if (evaluation.energized) energizedCoils.add(instance.id);
      continue;
    }

    if (electrical.kind === "lamp") {
      const across = polarityAcross(
        stateAt(lookup, instance.id, electrical.terminalA),
        stateAt(lookup, instance.id, electrical.terminalB),
      );
      if (across !== "none") litLamps.add(instance.id);
    }
  }

  return { energizedCoils, litLamps };
};

/**
 * 電位が止まっている箇所を集める。
 *
 * 開いている 2 端子のうち **片側だけが電源のある側に届いている**なら、
 * そこが電位の先端。閉じれば先へ進む。
 *
 * **「片側が + / 反対側が 0V」を先端とは呼ばない。** 負荷はグラフ上で
 * union されていない（design.md §5.2）ので、その 2 端子の間に負荷は無い ——
 * 閉じれば経路が通るのではなく**電源短絡になる**。指摘としては意味を持つが、
 * それは `detectPowerShortCircuits` の担当であって、ここで「あと少しで
 * 励磁します」の顔をして出してよいものではない。
 *
 * 両側が同じ側に届いている接点も先端ではない（閉じても何も変わらない）。
 */
const collectBlockers = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
  lookup: { netOf: ReadonlyMap<string, number>; netState: ReadonlyMap<number, NetState> },
  input: SimulationInput,
): PreviewBlocker[] => {
  const blockers: PreviewBlocker[] = [];

  for (const instance of document.components) {
    const definition = definitions.get(instance.definitionId);
    if (!definition) continue;

    /*
      **`input` をそのまま渡す。** ここを `AT_REST` で決め打ちすると、
      操作して閉じたスイッチが「電位が止まっている箇所」に残り続け、
      画面では通電しているのに一覧には「操作すると閉じます」が並ぶ。
      リレー側は `NONE_ENERGIZED` のまま —— 接点は動かないのが約束。
    */
    for (const [a, b] of openPairs(
      instance.id,
      definition.electrical,
      input,
      NONE_ENERGIZED,
    )) {
      const stateA = stateAt(lookup, instance.id, a);
      const stateB = stateAt(lookup, instance.id, b);

      // 閉じれば同じ電源の + と 0V が繋がる 2 端子。先端ではなく短絡なので飛ばす
      if (spansSupply(stateA, stateB) || spansSupply(stateB, stateA)) continue;

      for (const side of ["plus", "zero"] as const) {
        const reaches = side === "plus" ? reachesPlus : reachesZero;
        const hasA = reaches(stateA);
        const hasB = reaches(stateB);
        if (hasA === hasB) continue;
        blockers.push({
          componentId: instance.id,
          fedTerminalId: hasA ? a : b,
          blockedTerminalId: hasA ? b : a,
          side,
        });
      }
    }
  }

  return blockers;
};

/**
 * 回路を 1 回だけ解き、電位の到達範囲と止まっている箇所を返す。
 *
 * `input` はスイッチの操作だけ（既定は無操作＝静止状態）。**リレーは常に
 * 非励磁**で、渡す口も無い（`solveWithoutRelays`）。
 *
 * 部品が 1 つも無い回路でも空の解を返す（呼び出し側で分岐させない）。
 */
export const previewPaths = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
  input: SimulationInput = AT_REST,
): PathPreview => {
  const lookup = solveWithoutRelays(document, definitions, input);
  const { energizedCoils, litLamps } = collectActiveLoads(
    document,
    definitions,
    lookup,
  );

  return {
    netOf: lookup.netOf,
    netState: lookup.netState,
    energizedCoils,
    litLamps,
    blockers: collectBlockers(document, definitions, lookup, input),
  };
};
