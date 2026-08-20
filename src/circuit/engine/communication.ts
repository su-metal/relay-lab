/**
 * 通信の解決（design.md §4.17・§5.19）。
 *
 * **通信は電気モデルに参加しない。** 運ぶのは電位ではなく値で、ネットの
 * 分割にも `NetState` にも触れない。組み終わったネットの上で「どのポートと
 * どのポートが繋がっているか」を読み、値を配るだけ。アナログ量（§5.17）が
 * 第 2 パスとして重なるのと同じ位置にいる。
 *
 * **プロトコルは扱わない。** フレーム・アドレス・ボーレートは再現せず、
 * 運ぶのは「どの名前がいくつか」だけ。実機の通信内容は社内の作りであり、
 * このシミュレーターが読ませたいのは**配線が正しいかどうか**のほう。
 *
 * このファイルは型番を見ない（CLAUDE.md 設計原則 2）。送り手と受け手は
 * `signalId` という共有した名前だけで繋がる。
 */

import type {
  CircuitComponentInstance,
  CircuitDocument,
  ComponentDefinition,
  ComponentDefinitionRegistry,
  CommunicationPort,
  SimulationInput,
  Warning,
} from "@/circuit/types";
import { operationKey, terminalKey, terminalRefKey } from "@/circuit/types";

/** 回路に置かれた通信ポート 1 つ分。ネット ID まで解決してある */
type ResolvedPort = {
  instance: CircuitComponentInstance;
  definition: ComponentDefinition;
  port: CommunicationPort;
  plusNet: number | undefined;
  minusNet: number | undefined;
  /** 基準のネット。機器内で繋がっているのでどの端子から引いても同じ */
  commonNet: number | undefined;
};

/** 通信線の配線の不備（design.md §5.19） */
export type CommunicationFault =
  /** ＋か−のどちらかしか繋がっていない */
  | "half-wired"
  /** ＋と−が逆に繋がっている */
  | "reversed"
  /** 基準（GND）が共通でない */
  | "common-mismatch";

const netOfTerminal = (
  netOf: ReadonlyMap<string, number>,
  componentId: string,
  terminalId: string,
): number | undefined => netOf.get(terminalKey(componentId, terminalId));

/**
 * `document.connections` に現れる端子（`terminalKey()` の文字列）の集合。
 *
 * `buildNets()` は配線の有無に関わらず**すべての端子をネットのノードとして
 * 登録する**ので、`netOf.get()` は未配線の端子でも（自分だけの孤立したネットとして）
 * 値を返してしまう。「配線されているか」を知るには、ネットの有無ではなく
 * ここを見る必要がある。
 */
const wiredTerminalKeys = (document: CircuitDocument): ReadonlySet<string> => {
  const wired = new Set<string>();
  for (const connection of document.connections) {
    wired.add(terminalRefKey(connection.from));
    wired.add(terminalRefKey(connection.to));
  }
  return wired;
};

const resolvePorts = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
  netOf: ReadonlyMap<string, number>,
): ResolvedPort[] => {
  const ports: ResolvedPort[] = [];
  const wired = wiredTerminalKeys(document);

  for (const instance of document.components) {
    const definition = definitions.get(instance.definitionId);
    const port = definition?.communication?.port;
    if (!definition || !port) continue;

    /*
     * 基準は機器内で繋がっている。1 本でも配線されていればそれを使う ——
     * ただし「配線されている」の判定は `wired`（実際の `CircuitConnection`）
     * で行う。`netOf` の有無では判定できない（未配線の端子も孤立ネットを
     * 持つため、配列の先頭の端子が常に採用されてしまい、他の端子へ
     * 繋いでも一生反映されない）。
     */
    let commonNet: number | undefined;
    for (const common of port.commonTerminals) {
      if (!wired.has(terminalKey(instance.id, common))) continue;
      const net = netOfTerminal(netOf, instance.id, common);
      if (net !== undefined) {
        commonNet = net;
        break;
      }
    }

    ports.push({
      instance,
      definition,
      port,
      plusNet: netOfTerminal(netOf, instance.id, port.plusTerminal),
      minusNet: netOfTerminal(netOf, instance.id, port.minusTerminal),
      commonNet,
    });
  }

  return ports;
};

/**
 * 2 つのポートが**同じ通信線に繋がっているか**（配線の意図として）。
 *
 * 正しく繋がっていなくても「繋ごうとしている」ことは読めるようにする ——
 * ＋どうしだけ繋いだ状態も、逆に繋いだ状態も、ここでは「対」と見なす。
 * そうしないと**配線ミスを指摘する相手が見つからない。**
 */
const isLinked = (a: ResolvedPort, b: ResolvedPort): boolean => {
  const nets = [a.plusNet, a.minusNet];
  return [b.plusNet, b.minusNet].some(
    (net) => net !== undefined && nets.includes(net),
  );
};

/** この 2 ポートの配線の不備。空なら成立している */
const faultsBetween = (a: ResolvedPort, b: ResolvedPort): CommunicationFault[] => {
  const faults: CommunicationFault[] = [];

  const straight =
    a.plusNet !== undefined &&
    a.plusNet === b.plusNet &&
    a.minusNet !== undefined &&
    a.minusNet === b.minusNet;
  const crossed =
    a.plusNet !== undefined &&
    a.plusNet === b.minusNet &&
    a.minusNet !== undefined &&
    a.minusNet === b.plusNet;

  if (crossed) faults.push("reversed");
  else if (!straight) faults.push("half-wired");

  /*
   * **基準が共通でないと差動信号は成立しない**（design.md §5.17 の
   * 調光信号とまったく同じ話）。逆結線と同時に起きることもあるので、
   * どちらか 1 つに丸めず両方を出す —— 片方だけ直して直らないのが
   * いちばん時間を溶かす。
   */
  if (
    a.commonNet === undefined ||
    b.commonNet === undefined ||
    a.commonNet !== b.commonNet
  ) {
    faults.push("common-mismatch");
  }

  return faults;
};

/** 成立している通信リンク 1 本 */
type Link = { from: ResolvedPort; to: ResolvedPort };

type Resolution = {
  links: Link[];
  /** 不備のあるポートの組。警告に使う */
  broken: { a: ResolvedPort; b: ResolvedPort; faults: CommunicationFault[] }[];
};

const resolveLinks = (ports: readonly ResolvedPort[]): Resolution => {
  const links: Link[] = [];
  const broken: Resolution["broken"] = [];

  for (let i = 0; i < ports.length; i += 1) {
    for (let j = i + 1; j < ports.length; j += 1) {
      const a = ports[i];
      const b = ports[j];
      if (!isLinked(a, b)) continue;

      const faults = faultsBetween(a, b);
      if (faults.length > 0) {
        broken.push({ a, b, faults });
        continue;
      }
      // 成立。向きは持たないので両向きに入れる（送り手か受け手かは定義が決める）
      links.push({ from: a, to: b });
      links.push({ from: b, to: a });
    }
  }

  return { links, broken };
};

/**
 * 送り手が出している値（`signalId` → 0–100%）。
 *
 * `"level"` の操作子はフェーダーの位置、`"switch"` は倒していれば 100%、
 * 倒していなければ 0%。**入り切りも % に揃える** —— 受け手は「いくつか」
 * だけを見ればよくなり、`kind` による分岐が受け手側に漏れない。
 */
const transmittedValues = (
  port: ResolvedPort,
  input: SimulationInput,
): Map<string, number> => {
  const values = new Map<string, number>();
  const communication = port.definition.communication;
  const electrical = port.definition.electrical;
  if (!communication?.transmits || electrical.kind !== "relay") return values;

  const operations = electrical.relay.operations ?? [];
  for (const signalId of communication.transmits) {
    const operation = operations.find((entry) => entry.id === signalId);
    if (!operation) continue;

    const key = operationKey(port.instance.id, operation.id);
    if (operation.kind === "level") {
      const level = input.deviceLevels?.get(key);
      const percent =
        level === undefined || !Number.isFinite(level)
          ? (operation.defaultPercent ?? 0)
          : level;
      values.set(signalId, Math.min(Math.max(percent, 0), 100));
    } else {
      values.set(signalId, input.operatedDevices?.has(key) ? 100 : 0);
    }
  }

  return values;
};

/**
 * 通信で決まったチャンネルの値（componentId → チャンネル ID → 0–100%）。
 *
 * **電圧ではなく % を返す。** V への変換は受け手の機器の設定
 * （`analog-source.outputCurve` とインスタンスの極性）が持つもので、
 * 通信が運ぶのは「フェーダーが 70%」という値だけ（design.md §4.17）。
 */
export type CommunicatedLevels = ReadonlyMap<string, ReadonlyMap<string, number>>;

export const EMPTY_COMMUNICATED_LEVELS: CommunicatedLevels = new Map();

export const resolveCommunication = (
  document: CircuitDocument,
  definitions: ComponentDefinitionRegistry,
  netOf: ReadonlyMap<string, number>,
  input: SimulationInput,
): { levels: CommunicatedLevels; warnings: Warning[] } => {
  const ports = resolvePorts(document, definitions, netOf);
  if (ports.length === 0) {
    return { levels: EMPTY_COMMUNICATED_LEVELS, warnings: [] };
  }

  const { links, broken } = resolveLinks(ports);
  const levels = new Map<string, Map<string, number>>();

  for (const link of links) {
    const receives = link.to.definition.communication?.receives;
    if (!receives || receives.length === 0) continue;

    const values = transmittedValues(link.from, input);
    if (values.size === 0) continue;

    const forDevice = levels.get(link.to.instance.id) ?? new Map<string, number>();
    for (const binding of receives) {
      const percent = values.get(binding.signalId);
      if (percent === undefined) continue;
      forDevice.set(binding.channelId, percent);
    }
    if (forDevice.size > 0) levels.set(link.to.instance.id, forDevice);
  }

  return { levels, warnings: warningsFor(broken) };
};

const FAULT_MESSAGE: Record<CommunicationFault, string> = {
  "half-wired":
    "通信線が片側しか繋がっていません。＋と − の両方を繋いでください。",
  reversed:
    "通信線の ＋ と − が逆に繋がっています。相手の ＋ は ＋ へ、− は − へ繋いでください。",
  "common-mismatch":
    "通信の基準（GND）が共通になっていません。差動信号は基準を共有していないと成立しないので、両機器の GND どうしを繋いでください。",
};

const warningsFor = (broken: Resolution["broken"]): Warning[] =>
  broken.flatMap(({ a, b, faults }) =>
    faults.map((fault) => ({
      code: "communication-wiring" as const,
      severity: "warning" as const,
      message: `${a.instance.label ?? a.definition.model} と ${
        b.instance.label ?? b.definition.model
      } の間で、${FAULT_MESSAGE[fault]}`,
      componentId: a.instance.id,
      terminalId: a.port.plusTerminal,
    })),
  );
