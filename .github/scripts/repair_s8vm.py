from pathlib import Path
import re


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"anchor not found in {path}: {old[:80]!r}")
    p.write_text(text.replace(old, new, 1))


Path("src/circuit/definitions/omron/s8vm-05024.ts").write_text('''import type { ComponentDefinition } from "@/circuit/types";

/**
 * OMRON S8VM-05024 — 50W / DC24V 2.2A、オープン・底面取りつけタイプ。
 *
 * OMRON 公式資料:
 * - 形式/種類: S8VM-05024 = 50W / 24V / 2.2A、オープン・底面取りつけ
 *   https://www.fa.omron.co.jp/products/family/1616/lineup/
 * - 定格/性能: 定格入力 AC100〜240V、使用可能範囲 AC85〜265V
 *   https://www.fa.omron.co.jp/products/family/1616/specification/
 * - 配線/接続: 「形S8VM-050□□□□（50W）」ブロック図
 *   https://www.fa.omron.co.jp/products/family/1616/network/
 *
 * 実機の端子表示は L / N / FG / -V / +V。
 * 資料中の 1 / 2 / 3 は説明項目番号で、物理端子番号ではない。
 * `number` には実機に刻印される端子記号そのものを保持する。
 */
export const S8VM_05024_SOURCE =
  "https://www.fa.omron.co.jp/products/family/1616/network/";

export const omronS8vm05024: ComponentDefinition = {
  id: "omron-s8vm-05024",
  manufacturer: "OMRON",
  model: "S8VM-05024",
  category: "power",
  terminals: [
    { id: "L", label: "L", number: "L", role: "power_line", description: "AC入力 L / 定格AC100〜240V（使用可能範囲AC85〜265V）", position: { x: 0, y: 0.25 }, side: "left" },
    { id: "N", label: "N", number: "N", role: "power_neutral", description: "AC入力 N / 定格AC100〜240V（使用可能範囲AC85〜265V）", position: { x: 0, y: 0.48 }, side: "left" },
    { id: "FG", label: "FG", number: "FG", role: "generic", description: "FG / フレームグラウンド端子（保護接地）", position: { x: 0.5, y: 1 }, side: "bottom" },
    { id: "-V", label: "-V", number: "-V", role: "power_zero", description: "DC出力 -V / DC24V", position: { x: 1, y: 0.62 }, side: "right" },
    { id: "+V", label: "+V", number: "+V", role: "power_positive", description: "DC出力 +V / DC24V・定格2.2A", position: { x: 1, y: 0.34 }, side: "right" },
  ],
  electrical: {
    kind: "ac-dc-power-supply",
    ratedInputVoltageMin: 100,
    ratedInputVoltageMax: 240,
    allowableInputVoltageMin: 85,
    allowableInputVoltageMax: 265,
    lineTerminal: "L",
    neutralTerminal: "N",
    outputVoltage: 24,
    positiveTerminal: "+V",
    zeroTerminal: "-V",
    ratedOutputCurrent: 2.2,
    ratedPower: 50,
  },
  visual: { width: 200, height: 180 },
  source: S8VM_05024_SOURCE,
  verified: true,
};
''')

replace_once(
    "src/circuit/types/component.ts",
    '''  | {
      kind: "ac-dc-power-supply";
      inputVoltageMin: number;
      inputVoltageMax: number;
      lineTerminal: string;
      neutralTerminal: string;
      outputVoltage: number;
      positiveTerminal: string;
      zeroTerminal: string;
      ratedOutputCurrent?: number;
      ratedPower?: number;
    }''',
    '''  | {
      kind: "ac-dc-power-supply";
      ratedInputVoltageMin: number;
      ratedInputVoltageMax: number;
      allowableInputVoltageMin: number;
      allowableInputVoltageMax: number;
      lineTerminal: string;
      neutralTerminal: string;
      outputVoltage: number;
      positiveTerminal: string;
      zeroTerminal: string;
      ratedOutputCurrent?: number;
      ratedPower?: number;
    }''',
)

p = Path("src/circuit/engine/graph.ts")
text = p.read_text()
pattern = re.compile(r'''  const compatibleAcSource = \(sourceId: string, min: number, max: number\): boolean => \{.*?\n  \};''', re.S)
replacement = '''  const isAcSource = (sourceId: string): boolean => {
    const source = instanceById.get(sourceId);
    if (!source) return false;
    const sourceElectrical = definitions.get(source.definitionId)?.electrical;
    return sourceElectrical?.kind === "power" && sourceElectrical.currentType === "AC";
  };'''
text, count = pattern.subn(replacement, text, count=1)
if count != 1:
    raise SystemExit("compatibleAcSource block not found")
text = re.sub(r'compatibleAcSource\(sourceId,\s*electrical\.inputVoltageMin,\s*electrical\.inputVoltageMax\)', 'isAcSource(sourceId)', text)
text = text.replace("// AC-DC 電源は、L/N が同じ適合 AC 電源の両極へ届いたときだけ DC 出力を持つ。", "// AC-DC 電源は、L/N が同じ AC 電源の両極へ届いたときだけ DC 出力を持つ。\n  // 入力電圧範囲は仕様情報として保持するが、既存要件どおり電圧不一致判定には使わない。")
p.write_text(text)

p = Path("src/circuit/adapter/path-graph.ts")
text = p.read_text()
text = text.replace('import { conductingPairs } from "@/circuit/engine";', 'import { buildNets, computeNetStates, conductingPairs } from "@/circuit/engine";', 1)
anchor = '''  for (const connection of document.connections) {
    connect(
      terminalRefKey(connection.from),
      terminalRefKey(connection.to),
      connection.id,
    );
  }

  for (const instance of document.components) {'''
replacement = '''  for (const connection of document.connections) {
    connect(
      terminalRefKey(connection.from),
      terminalRefKey(connection.to),
      connection.id,
    );
  }

  const nets = buildNets(
    document,
    definitions,
    { pressedSwitches },
    energizedRelays,
  );
  const states = computeNetStates(document, definitions, nets);

  for (const instance of document.components) {'''
if anchor not in text:
    raise SystemExit("path graph insertion anchor not found")
text = text.replace(anchor, replacement, 1)
anchor = '''    if (electrical.kind === "power") {
      connect(terminalKey(instance.id, electrical.positiveTerminal), PLUS_NODE);
      connect(terminalKey(instance.id, electrical.zeroTerminal), ZERO_NODE);
    }
  }'''
replacement = '''    if (electrical.kind === "power") {
      connect(terminalKey(instance.id, electrical.positiveTerminal), PLUS_NODE);
      connect(terminalKey(instance.id, electrical.zeroTerminal), ZERO_NODE);
    }

    if (electrical.kind === "ac-dc-power-supply") {
      const plusNet = nets.netOf.get(terminalKey(instance.id, electrical.positiveTerminal));
      const zeroNet = nets.netOf.get(terminalKey(instance.id, electrical.zeroTerminal));
      const powered =
        plusNet !== undefined &&
        zeroNet !== undefined &&
        states.get(plusNet)?.plusFrom.has(instance.id) === true &&
        states.get(zeroNet)?.zeroFrom.has(instance.id) === true;
      if (powered) {
        connect(terminalKey(instance.id, electrical.positiveTerminal), PLUS_NODE);
        connect(terminalKey(instance.id, electrical.zeroTerminal), ZERO_NODE);
      }
    }
  }'''
if anchor not in text:
    raise SystemExit("path graph power anchor not found")
p.write_text(text.replace(anchor, replacement, 1))

p = Path("src/circuit/adapter/ladder.ts")
text = p.read_text()
text = text.replace('    if (electrical.kind === "power") {', '''    if (
      electrical.kind === "power" ||
      electrical.kind === "ac-dc-power-supply"
    ) {''', 1)
text = text.replace('''      case "power":
      case "terminal":''', '''      case "power":
      case "ac-dc-power-supply":
      case "terminal":''', 1)
p.write_text(text)

p = Path("src/circuit/definitions/__tests__/registry.test.ts")
text = p.read_text()
start_marker = '  /**\n   * 実端子を持たない純粋な汎用部品は検証済みを名乗らない。'
if start_marker not in text:
    raise SystemExit("registry verification block not found")
start = text.index(start_marker)
end = text.index('\n\n  it("部品ごとに端子 ID が重複しない"', start)
block = '''  /**
   * 実端子番号／記号を持たない定義は検証済みを名乗らない。
   * S8VM の L/N/FG/-V/+V のような文字記号も実機刻印なので `number` に保持する。
   */
  it("実端子番号／記号を持たない定義は検証済みを名乗らない", () => {
    for (const definition of componentDefinitions) {
      const hasRealTerminals = definition.terminals.some((terminal) => terminal.number !== undefined);
      if (hasRealTerminals) continue;
      expect(definition.verified, definition.id).toBe(false);
    }
  });'''
p.write_text(text[:start] + block + text[end:])

Path("src/circuit/adapter/__tests__/s8vm-power-source.test.ts").write_text('''import { describe, expect, it } from "vitest";

import { buildLadder } from "@/circuit/adapter/ladder";
import { buildPathGraph, PLUS_NODE, ZERO_NODE, reachableFrom } from "@/circuit/adapter/path-graph";
import { componentRegistry } from "@/circuit/definitions";
import type { CircuitConnection, CircuitDocument } from "@/circuit/types";
import { terminalKey } from "@/circuit/types";

const wire = (from: string, to: string): CircuitConnection => {
  const [fromComponent, fromTerminal] = from.split(":");
  const [toComponent, toTerminal] = to.split(":");
  return { id: `${from}-${to}`, from: { componentId: fromComponent, terminalId: fromTerminal }, to: { componentId: toComponent, terminalId: toTerminal } };
};

const circuit = (withInput: boolean): CircuitDocument => ({
  version: 1,
  components: [
    { id: "AC1", definitionId: "power-ac100v", position: { x: 0, y: 0 } },
    { id: "PS1", definitionId: "omron-s8vm-05024", position: { x: 180, y: 0 } },
    { id: "PL1", definitionId: "lamp-dc24v", position: { x: 360, y: 0 } },
  ],
  connections: [
    ...(withInput ? [wire("AC1:L", "PS1:L"), wire("AC1:N", "PS1:N")] : []),
    wire("PS1:+V", "PL1:1"), wire("PL1:2", "PS1:-V"),
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
});

describe("S8VM-05024 の adapter 統合", () => {
  it("一次側が生きているときだけ二次側を電源として扱う", () => {
    const on = buildPathGraph(circuit(true), componentRegistry, new Set(), new Set());
    expect(reachableFrom(on, PLUS_NODE).has(terminalKey("PS1", "+V"))).toBe(true);
    expect(reachableFrom(on, ZERO_NODE).has(terminalKey("PS1", "-V"))).toBe(true);
    const off = buildPathGraph(circuit(false), componentRegistry, new Set(), new Set());
    expect(reachableFrom(off, PLUS_NODE).has(terminalKey("PS1", "+V"))).toBe(false);
    expect(reachableFrom(off, ZERO_NODE).has(terminalKey("PS1", "-V"))).toBe(false);
  });

  it("ラダー図では S8VM の DC 出力を電源母線として扱う", () => {
    const document: CircuitDocument = {
      version: 1,
      components: [
        { id: "PS1", definitionId: "omron-s8vm-05024", position: { x: 0, y: 0 } },
        { id: "PL1", definitionId: "lamp-dc24v", position: { x: 200, y: 0 } },
      ],
      connections: [wire("PS1:+V", "PL1:1"), wire("PL1:2", "PS1:-V")],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    const ladder = buildLadder(document, componentRegistry);
    const lamp = ladder.rungs.find((rung) => rung.output.componentId === "PL1");
    expect(lamp).toBeDefined();
    expect(lamp?.blocked).toBeUndefined();
  });
});
''')

p = Path("CLAUDE.md")
text = p.read_text()
old = '2. **エンジンに型番分岐を書かない。** `if (model === "MY4N")` は禁止。エンジンは `ComponentDefinition` を読んで動作する。新型番の追加が定義ファイル 1 枚で完結すること。'
new = '2. **エンジンに型番分岐を書かない。** `if (model === "MY4N")` は禁止。エンジンは `ComponentDefinition` を読んで動作する。**既に対応済みの電気的な振る舞いを持つ新型番**の追加が定義ファイル 1 枚で完結すること。新しい物理的な振る舞いを初めて導入するときは、型番名ではなく汎用の `ElectricalDefinition.kind` として一度だけ追加し、その後の同種型番ではエンジンを触らない。'
if old not in text:
    raise SystemExit("CLAUDE principle 2 anchor missing")
p.write_text(text.replace(old, new, 1))

p = Path("requirements_definition.md")
text = p.read_text()
old = '| 電源 | DC24V 電源（+24V 端子 / 0V 端子）/ AC100V 電源（L 端子 / N 端子） |'
new = '| 電源 | DC24V 電源（+24V 端子 / 0V 端子）/ AC100V 電源（L 端子 / N 端子）/ OMRON S8VM-05024（AC入力 L/N・FG・DC出力 -V/+V） |'
if old not in text:
    raise SystemExit("requirements power row missing")
text = text.replace(old, new, 1)
anchor = 'AC 電源は**交流として扱わない。** 位相・実効値・力率は再現せず、L と N は電位差の両端としてのみ扱う。定格電圧の不一致（AC100V の回路に DC24V のランプなど）も検出しない（`design.md` §4.13）。'
addition = 'OMRON S8VM-05024 は**実型番の AC-DC スイッチング電源**として扱う。実機端子表示は L / N / FG / -V / +V、定格入力 AC100〜240V（使用可能範囲 AC85〜265V）、出力 DC24V・2.2A・50W。シミュレーションでは L/N が同じ AC 電源の両端へ届いたときだけ +V/-V に DC 電源を成立させ、一次側と二次側は内部で導通させない。入力電圧範囲は仕様情報として保持するが、既存方針どおり**定格電圧不一致の一般判定は行わない**。\n\n'
if anchor not in text:
    raise SystemExit("requirements AC paragraph missing")
p.write_text(text.replace(anchor, addition + anchor, 1))

p = Path("design.md")
text = p.read_text()
if '### 4.18 OMRON S8VM-05024' not in text:
    idx = text.find('\n## 5. ')
    if idx < 0:
        raise SystemExit("design section 5 marker missing")
    text = text[:idx] + '''\n\n### 4.18 OMRON S8VM-05024（AC-DC スイッチング電源）\n\nOMRON 公式 S8VM 資料で照合した実型番。50W / DC24V 2.2A、定格入力 AC100〜240V、使用可能範囲 AC85〜265V。端子は実機表示どおり `L` / `N` / `FG` / `-V` / `+V` を持ち、これらの刻印を `TerminalDefinition.number` にそのまま保持する。\n\n`ElectricalDefinition.kind = "ac-dc-power-supply"` は型番固有の分岐ではなく、同種 AC-DC 電源が共有する振る舞い。一次側 L/N と二次側 -V/+V は union せず、同じ AC 電源の両極が L/N に届いたときだけ二次側へその電源自身の DC 電位を生成する。入力電圧範囲は仕様情報として保持するが、§4.13 の既存方針どおり定格電圧不一致の判定には使わない。FG は実端子として表示するが、保護接地系そのものは現行シミュレータの電位計算対象外。\n''' + text[idx:]
if '### 5.20 AC-DC 電源の電位生成' not in text:
    idx = text.find('\n## 6. ')
    if idx < 0:
        raise SystemExit("design section 6 marker missing")
    text = text[:idx] + '''\n\n### 5.20 AC-DC 電源の電位生成\n\n`computeNetStates()` は従来の `kind: "power"` と有向伝搬を解いたあと、`kind: "ac-dc-power-supply"` の L/N を確認する。同じ AC 電源 ID の両極が届いていれば、その AC-DC 電源自身の component ID を +V 側の `plusFrom` と -V 側の `zeroFrom` に追加する。一次側と二次側は union しないため絶縁は保つ。\n\n経路グラフはエンジンが解いた `NetState` を読み、実際に二次出力が成立しているときだけ +V/-V を仮想電源ノードへ接続する。ラダー図は瞬時状態ではなく配線トポロジーを表すため、S8VM の +V/-V を DC 側の母線として扱う。\n''' + text[idx:]
p.write_text(text)
