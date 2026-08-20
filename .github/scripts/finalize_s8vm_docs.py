from pathlib import Path

# component.ts: kind 数の固定表現をやめ、新しい物理挙動を追加した設計と一致させる
p = Path("src/circuit/types/component.ts")
s = p.read_text()
s = s.replace(
''' * エンジンが持ってよい分岐はこの `kind` の 7 通りだけ。
 * 端子は必ず ID 参照で指定し、端子番号そのものをエンジンに埋め込まない。
''',
''' * エンジンが持ってよい分岐は、この `kind` が表す汎用の電気的な振る舞いだけ。
 * 端子は必ず ID 参照で指定し、端子番号や型番そのものをエンジンに埋め込まない。
''', 1)
s = s.replace(
''' * 7 通目の `analog-source` だけは既存のどれにも寄せられない。
 * 電位を配る `power` でも、電位差を受ける `lamp` でもなく、
 * **基準に対する電圧値を出す**という別の振る舞いだから
 * （design.md §5.17）。
''',
''' * `analog-source` は基準に対する電圧値を出す振る舞い、
 * `ac-dc-power-supply` は入力側の成立を条件に絶縁された出力電位を生成する振る舞いで、
 * いずれも既存 kind へ無理に寄せず、型番非依存の振る舞いとして定義する。
''', 1)
p.write_text(s)

# CLAUDE.md: 検証済み実型番一覧へ S8VM を反映
p = Path("CLAUDE.md")
s = p.read_text()
old = 'MY2N / MY4N / MY4N-D2 は OMRON 公式データシート（J199）と照合済み、G7L-1A-B / G7L-2A-B は公式カタログ（CDPA-041C）と照合済みで `verified: true`（`design.md` §4.4・§4.9）。'
new = 'MY2N / MY4N / MY4N-D2 は OMRON 公式データシート（J199）と照合済み、G7L-1A-B / G7L-2A-B は公式カタログ（CDPA-041C）と照合済み、S8VM-05024 は OMRON 公式 S8VM の「形式/種類」「定格/性能」「配線/接続（形S8VM-050□□□□（50W）ブロック図）」と照合済みで `verified: true`（`design.md` §4.4・§4.9・§4.18）。'
if old not in s:
    raise SystemExit('CLAUDE verified models anchor not found')
p.write_text(s.replace(old, new, 1))

# design.md: ディレクトリ構成と §3 型定義を実装に合わせる
p = Path("design.md")
s = p.read_text()
old = '''        g7l-1a-b-dc24.ts
        g7l-2a-b-dc24.ts
      power.ts'''
new = '''        g7l-1a-b-dc24.ts
        g7l-2a-b-dc24.ts
        s8vm-05024.ts           # AC-DC スイッチング電源（§4.18）
      power.ts'''
if old not in s:
    raise SystemExit('design directory anchor not found')
s = s.replace(old, new, 1)
old = '''  | { kind: "power";  voltage: number; currentType: "DC" | "AC";
      positiveTerminal: string; zeroTerminal: string }
  | { kind: "relay";  relay: RelayDefinition }'''
new = '''  | { kind: "power";  voltage: number; currentType: "DC" | "AC";
      positiveTerminal: string; zeroTerminal: string }
  | { kind: "ac-dc-power-supply";             // 入力成立時だけ絶縁 DC 出力を生成（§4.18・§5.20）
      ratedInputVoltageMin: number; ratedInputVoltageMax: number;
      allowableInputVoltageMin: number; allowableInputVoltageMax: number;
      lineTerminal: string; neutralTerminal: string;
      outputVoltage: number; positiveTerminal: string; zeroTerminal: string;
      ratedOutputCurrent?: number; ratedPower?: number }
  | { kind: "relay";  relay: RelayDefinition }'''
if old not in s:
    raise SystemExit('design ElectricalDefinition anchor not found')
s = s.replace(old, new, 1)
old = '''**`kind` を増やすのは最後の手段。** タイマーは `relay` の `delay`、調光ランプは `lamp` の `dimming`、フェードする調光出力は `analog-source` の `fade` で表しており、どれも `kind` を増やしていない（CLAUDE.md 設計原則 7）。`analog-source` だけが増えたのは、既存のどれにも寄せられなかったから —— 電位を配る `power` でも、電位差を受ける `lamp` でもなく、**基準に対する電圧値を出す**という別の振る舞いだった。'''
new = '''**`kind` を増やすのは最後の手段。** タイマーは `relay` の `delay`、調光ランプは `lamp` の `dimming`、フェードする調光出力は `analog-source` の `fade` で表しており、既存の振る舞いの設定差では `kind` を増やさない（CLAUDE.md 設計原則 2・7）。一方、`analog-source` は**基準に対する電圧値を出す**、`ac-dc-power-supply` は**入力側と絶縁した別の電源電位を条件付きで生成する**という既存 kind では表せない物理的な振る舞いなので、型番非依存の kind として追加する。'''
if old not in s:
    raise SystemExit('design kind rationale anchor not found')
p.write_text(s.replace(old, new, 1))
