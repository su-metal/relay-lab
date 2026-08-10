# 設計ドキュメント — relay-lab

対象範囲: MVP（`requirements.md` の作業単位）およびその土台となる全体アーキテクチャ。

---

## 1. アーキテクチャ全体像

```
┌─────────────────────────────────────────────┐
│ UI 層 (React / React Flow)                   │
│  CircuitCanvas / ComponentPalette /          │
│  PropertiesPanel / Toolbar / DeviceNode      │
└───────────────┬─────────────────────────────┘
                │ adapter (nodes/edges ⇄ document)
┌───────────────▼─────────────────────────────┐
│ 状態層 (Zustand)                              │
│  circuitStore     … 保存対象＋Undo/Redo       │
│  simulationStore  … 実行時状態のみ             │
└───────────────┬─────────────────────────────┘
                │ simulate(document, definitions, inputs)
┌───────────────▼─────────────────────────────┐
│ エンジン層 (純粋関数・React 非依存)             │
│  graph.ts / relay.ts / simulate.ts /         │
│  validation.ts                               │
└─────────────────────────────────────────────┘
```

**依存の向きは上から下の一方向のみ。** エンジン層は React・Zustand・React Flow を一切 import しない。これにより Vitest でエンジン単体を検証できる。

---

## 2. ディレクトリ構成

```
package.json
tsconfig.json                    # strict / paths "@/*" → "./src/*"
next.config.ts
vitest.config.ts                 # environment: node / include: src/**/*.test.ts
wrangler.jsonc                   # Cloudflare Workers へ静的アセットとして配る設定（§9）
.github/
  workflows/
    ci.yml                       # push / PR で typecheck → test → build（§9）
    deploy.yml                   # main への push で test → build → wrangler deploy（§9）
.claude/
  launch.json                    # dev サーバー起動設定
  settings.json                  # Stop フックの登録
  hooks/
    check-tests-pass.mjs         # npm test の検証ゲート
    check-docs-fresh.mjs         # design.md の更新漏れ検出

src/
  app/
    layout.tsx
    page.tsx                     # 3カラムレイアウト
    globals.css                  # 配色変数（配線色は §5.6）とリセット
    page.module.css

  components/
    circuit/
      CircuitWorkspace.tsx       # ReactFlowProvider + 3カラム
      CircuitCanvas.tsx
      ComponentPalette.tsx
      PropertiesPanel.tsx
      WarningList.tsx            # 診断（実行中）／配線チェック（停止中）・§8.4
      HelpDialog.tsx             # 操作ヘルプと既知の制約（§8.10）
      WireLegend.tsx             # 配線色の凡例。停止中＝役割（§5.8）／実行中＝状態（§5.6・§5.9）
      Toolbar.tsx
      palette-dnd.ts             # D&D の MIME と読み取り
      useSimulationSync.ts       # 入力変化 → simulate() の再実行トリガー（§8.2）
      useWiringCheck.ts          # 停止中の静的な配線チェックの駆動（§5.7・§8.4）
      useDocumentPersistence.ts  # LocalStorage への保存・復元の駆動（§8.4）
      useHistoryShortcuts.ts     # Undo / Redo のキーボード操作（§8.4）
      useFlipShortcut.ts         # F キーで選択部品を左右反転（§8.1）
      useArrangeShortcut.ts      # L キーで配置を自動整理（§8.9）
      useSimulationShortcut.ts   # S キーでシミュレーションを開始・停止（§8.2）
      auto-arrange.ts            # 整理の呼び出し口。ボタンと L キーの共通経路（§8.9）
      useRangeSelection.ts       # 範囲選択中の選択集合を毎フレーム決める（§8.6）
      range-selection.ts         # 範囲選択の対象（部品 / 配線）の型と表示文言（§8.6）
      keyboard.ts                # 自前ショートカット共通の入力欄除外（§8.1）
                                 # ※ キーの割り当てそのものは lib/shortcuts.ts
      *.module.css
    edges/
      WireEdge.tsx               # 配線の Edge。幹線をずらして重なりを解く（§8.7）
      WireEdge.module.css
    nodes/
      DeviceNode.tsx             # 汎用ノード（定義駆動で描画）
      DeviceTerminal.tsx         # Handle + 端子番号ラベル
      *.module.css
      bodies/                    # カテゴリ固有の見た目差分のみ
        index.ts                 # カテゴリ → ボディ の対応表
        types.ts                 # BodyProps
        bodies.module.css
        RelayBody.tsx
        SwitchBody.tsx
        PowerSupplyBody.tsx
        LampBody.tsx
        GenericBody.tsx          # 専用ボディが無いカテゴリのフォールバック
        DiodeBody.tsx
        TerminalBlockBody.tsx

  circuit/
    engine/
      index.ts                   # 公開インターフェース。UI 層はここだけを import する
      simulate.ts                # 収束ループ（エントリポイント）
      graph.ts                   # Union-Find とネット構築
      relay.ts                   # コイル判定・接点内部接続の生成
      diode.ts                   # ダイオードの有向導通と向きの判定（§5.4）
      potential.ts               # ネット電位の読み取り（atPlus / atZero / polarityAcross）
      validation.ts              # 短絡・極性・ダイオードの向き・未接続の検出
      wiring.ts                  # 静止状態の配線チェック（電源を入れる前の指摘・§5.7）
    types/
      index.ts                   # 再エクスポート。利用側は "@/circuit/types" から取る
      component.ts
      terminal.ts
      connection.ts
      circuit.ts
      simulation.ts
    definitions/
      index.ts                   # 全定義のレジストリ
      source-notes.ts            # 汎用部品の出典定型文（§4.5）
      omron/
        my-series.ts             # MY シリーズ共通の端子生成（§4.1〜§4.3）
        my2n-dc24.ts
        my4n-dc24.ts
        my4n-d2-dc24.ts
      power.ts
      switches.ts                # 押しボタン／切替スイッチ 4 種（§4.5・§4.7）
      lamps.ts
      diodes.ts
      terminals.ts
      __tests__/
        registry.test.ts         # レジストリ取得と §4.1〜§4.3 端子表の突き合わせ
        step7-scenarios.test.ts  # 追加部品の挙動（§4.6）
        switch-scenarios.test.ts # 切替スイッチ（オルタネート）の挙動（§4.7）
    persistence/
      document-storage.ts        # CircuitDocument ⇄ JSON と LocalStorage（§7）
      document-file.ts           # ファイル書き出しの書式とファイル名（§7・§8.4）
      __tests__/
        document-storage.test.ts # 往復と壊れた保存データの検証
        document-file.test.ts    # 書き出し → 読み戻しの往復とファイル名
    adapter/
      reactflow.ts               # Node/Edge ⇄ CircuitDocument
      simulation-view.ts         # SimulationResult → 配線色・部品状態（§5.6・§8.2）
      wire-role.ts               # 停止中の配線の役割配色（§5.8）
      self-hold.ts               # 自己保持しているリレーと保持経路の検出（§5.9）
      wire-lane.ts               # 配線の重なりを解く幹線のずらし量（§8.7）
      inspection.ts              # 選択部品 1 個の読み取り（§8.3）
      selection.ts               # 範囲選択の当たり判定（§8.6）
      auto-layout.ts             # 配置の自動整理（グリッド吸着・整列・重なり解消・§8.9）
      __tests__/
        reactflow.test.ts        # 往復変換と重複配線の判定（§8.1）
        simulation-view.test.ts  # 配線色の導出（§5.6）
        wire-role.test.ts        # 停止中の役割配色と b 接点チェーンの誤検出（§5.8）
        self-hold.test.ts        # 自己保持の検出と保持経路の絞り込み（§5.9）
        wire-lane.test.ts        # レーン分離の割り当て（§8.7）
        inspection.test.ts       # 接点の開閉と停止中の区別（§8.3）
        selection.test.ts        # 枠と部品・配線の交差（§8.6）
        auto-layout.test.ts      # 整列のクラスタリングと重なり解消（§8.9）

  store/
    circuitStore.ts              # ドキュメント＋選択＋Undo/Redo 履歴（§7）
    simulationStore.ts           # 実行時状態のみ（§7）
    __tests__/
      circuitStore.test.ts       # 履歴のスナップショット地点（§7）
      simulationStore.test.ts    # 操作入力の出し入れ（モーメンタリ／オルタネート・§4.7）

  lib/
    app-info.ts                  # アプリ名・収束の最大反復回数など UI とエンジンの共有定数
    component-display.ts         # 表示ラベル表（カテゴリ・端子役割・極性・電位）と
                                 # 実端子番号の有無
    component-search.ts          # パレットの絞り込み（§8.5）
    warning-display.ts           # 警告の並べ替えと束ね（§5.7・§8.4）
    shortcuts.ts                 # キー・マウス割り当ての単一の出典＋ヘルプの表（§8.10）
    help-content.ts              # 基本操作と「扱わないこと」の本文（§6・§8.10）
    __tests__/
      component-search.test.ts   # 検索の絞り込み規則（§8.5）
      shortcuts.test.ts          # ヘルプの表と実際のキー割り当ての一致（§8.10）

  __tests__/
    setup.test.ts                # ツールチェーン疎通のスモークテスト

  circuit/engine/__tests__/
    scenarios.test.ts            # 検証回路 テスト1〜5
    diode.test.ts                # 逆起電力吸収ダイオードの向き（§5.4）
    wiring.test.ts               # 静的な配線チェックの範囲と境界（§5.7）
```

**`potential.ts` を分けた理由。** 「+ 側にいる / 0V 側にいる」の解釈はコイル（`relay.ts`）とランプ（`simulate.ts`）の双方が必要とする。`graph.ts` に置くと `graph.ts → relay.ts → graph.ts` の循環参照になるため、依存の末端として独立させた。依存の向きは `potential.ts ← relay.ts ← graph.ts ← simulate.ts` の一本道。

**`diode.ts` の依存も同じ形。** `graph.ts` が電位伝搬（`spreadThroughDiodes`）を、`validation.ts` が向きの判定（`inspectDiodes`）を呼ぶ。`diode.ts` から `graph.ts` へ戻る参照は `NetLookup` の **型だけ**（`import type`）で、実行時の循環は無い。

**adapter のテストが `check-docs-fresh.mjs` の監視外にある理由。** 監視対象は
`types/` `definitions/` `engine/`（＝回路モデルそのもの）で、`adapter/` は表示との変換層。
ここは design.md §8.1・§8.2 と対応するので、変換規則を変えたときはそちらを直す。

**`persistence/` を store から分けた理由。** 「保存データを読めるか」の判定は
LocalStorage とも React とも無関係な純粋関数で、実体に触るのは薄い 3 関数だけに
閉じている。壊れた JSON・未知の `definitionId`・実在しない端子を指す配線を
弾けるかどうかを、ブラウザを起動せずに Vitest で確かめられる（§7）。

**`inspection.ts` を `simulation-view.ts` と分けた理由。** 前者はプロパティパネル
1 箇所のための読み取りで、後者はキャンバス全体の配線色。同じ `SimulationResult` を
入力に取るが、消費者も出力の形も別物なので混ぜない。詳細は §8.3。

**`simulation-view.ts` を adapter に置いた理由。** 「どのネットを緑にするか」は
エンジンの 2 ビットだけでは決まらず、負荷側の結果と突き合わせる必要がある（§5.6）。
これをエンジンに入れると表示都合が回路モデルへ染み出すので、adapter 側で受け持つ。
React を import しない純粋関数なので、UI を起動せずに配線色を検証できる。

**テストの配置。** エンジンのテストは `src/circuit/engine/__tests__/`、部品定義のテストは
`src/circuit/definitions/__tests__/` に置く。どちらも `check-docs-fresh.mjs` の監視対象配下なので、
テストを足すと design.md の更新が要求される。これは意図した挙動で、定義データとドキュメントの
端子表を必ず同時に直させるための仕掛け。ツールチェーン自体の疎通テストだけは回路モデルと
無関係なので `src/__tests__/` に分ける。

**要件書の構成からの変更点:** 型番ごとのノードコンポーネント（`RelayNode.tsx` 等）を作らず、汎用 `DeviceNode` が `ComponentDefinition` を読んで描画する。カテゴリ固有の差分（ランプの発光、押しボタンの押下表現）だけを `bodies/` に切り出す。これにより「新型番の追加＝定義ファイル 1 枚」を保証する。

---

## 3. 型定義

実装は `src/circuit/types/` の 5 ファイルに対応する。

| ファイル | 定義する型 |
|---|---|
| `terminal.ts` | `TerminalRole` / `TerminalSide` / `TerminalDefinition` |
| `component.ts` | `ComponentCategory` / `CoilPolarity` / `RelayContact` / `RelayDefinition` / `ElectricalDefinition` / `ComponentDefinition` / `ComponentDefinitionRegistry` |
| `connection.ts` | `TerminalRef` / `CircuitConnection` / `terminalKey()` |
| `circuit.ts` | `CircuitComponentInstance` / `CircuitDocument` |
| `simulation.ts` | `SimulationInput` / `NetState` / `WarningCode` / `WarningSeverity` / `Warning` / `SimulationStatus` / `SimulationResult` |

### 3.1 部品定義

```ts
type ComponentCategory =
  | "power" | "relay" | "switch" | "lamp" | "diode" | "terminal"

type TerminalRole =
  | "power_positive" | "power_zero"
  | "coil_positive" | "coil_negative"
  | "common" | "normally_open" | "normally_closed"
  | "anode" | "cathode"
  | "generic"

type TerminalSide = "top" | "right" | "bottom" | "left"  // React Flow Handle の向き

type TerminalDefinition = {
  id: string            // 内部ID。原則として端子番号と同じ文字列
  label: string         // 画面表示（"14" など）
  number?: string       // 実端子番号。汎用部品は持たない（§4.5）
  role: TerminalRole
  contactGroup?: string // "c1".."c4" — 同一接点に属する COM/NO/NC を束ねる
  description?: string  // ツールチップ本文（"コイル + / DC24V"）
  position: { x: number; y: number }  // 部品内の相対座標 0..1
  side: TerminalSide
}

type ComponentDefinition = {
  id: string                 // "omron-my4n-dc24"
  manufacturer?: string
  model: string
  category: ComponentCategory
  terminals: TerminalDefinition[]
  electrical: ElectricalDefinition
  visual: { width: number; height: number }
  source?: string            // 端子データの出典（データシートURL、汎用部品は §4.5 の定型文）
  verified: boolean          // 実機/データシートで検証済みか
}

// 定義ID → 定義。simulate() の第2引数 defs の型（§5.5）
type ComponentDefinitionRegistry = ReadonlyMap<string, ComponentDefinition>
```

`ComponentDefinitionRegistry` を Map にしているのは、**エンジンに部品の一覧を知らせないため。** エンジンは `CircuitDocument` に現れた `definitionId` を引くだけで、どんな型番が存在するかを知らない。新型番を足してもエンジンの入力の型は変わらない。

`ElectricalDefinition` はカテゴリごとの判別可能ユニオンとする。

```ts
type ElectricalDefinition =
  | { kind: "power";  voltage: number; currentType: "DC" | "AC";
      positiveTerminal: string; zeroTerminal: string }
  | { kind: "relay";  relay: RelayDefinition }
  | { kind: "switch"; contactType: "NO" | "NC"; action: "momentary" | "maintained";
      terminalA: string; terminalB: string }
  | { kind: "lamp";   voltage: number; currentType: "DC" | "AC";
      terminalA: string; terminalB: string }
  | { kind: "diode";  anodeTerminal: string; cathodeTerminal: string }
  | { kind: "terminal"; terminals: string[] }   // 全端子が常時導通
```

### 3.2 リレー定義

```ts
type CoilPolarity =
  | "none"       // 極性なし。どちら向きでも励磁
  | "indicator"  // 極性を逆にしても励磁するが、表示LEDが点灯しない
  | "strict"     // 正しい極性でのみ励磁。逆接は故障扱い（内蔵ダイオード順方向）

type RelayDefinition = {
  coil: {
    voltage: number
    currentType: "DC" | "AC"
    positiveTerminal: string
    negativeTerminal: string
    polarity: CoilPolarity
  }
  contacts: RelayContact[]
}

type RelayContact = {
  id: string            // "c1"
  commonTerminal: string
  noTerminal: string
  ncTerminal: string
  type: "SPDT"
}
```

**要件書からの変更点:** `polaritySensitive: boolean` を 3 値の `CoilPolarity` に変更した。理由は §5.3 を参照。

### 3.3 回路ドキュメント（保存対象）

```ts
type TerminalRef = {
  componentId: string   // 部品インスタンスID
  terminalId: string    // TerminalDefinition.id
}

type CircuitConnection = {
  id: string
  from: TerminalRef
  to:   TerminalRef
}

// Map/Set のキー書式。SimulationResult.netOf のキーもこれで作る
const terminalKey = (componentId: string, terminalId: string) =>
  `${componentId}:${terminalId}`

type CircuitDocument = {
  version: 1
  components: {
    id: string                 // インスタンスID
    definitionId: string       // ComponentDefinition.id
    label?: string             // "RY1" "S1" などのユーザー付与名
    position: { x: number; y: number }
    flipped?: boolean          // 左右反転して描くか（省略 = 反転なし）
  }[]
  connections: CircuitConnection[]
  viewport: { x: number; y: number; zoom: number }
}
```

`terminalKey()` を関数にしてあるのは、キー書式を 1 箇所に閉じるため。各所で `` `${a}:${b}` `` を手書きすると、書式がずれた瞬間にネット引きが静かに失敗する。

**`flipped` は見た目だけの属性で、電気的な意味を一切持たない。** 反転しても端子 ID・端子番号・役割は変わらず、`CircuitConnection` も `ElectricalDefinition` もまったく同じものを指す。**エンジンはこのフィールドを読まない**（§8.1）。`ComponentDefinition` 側ではなくインスタンス側に置いてあるのは、同じ型番を反転して並べられる必要があるため。定義は全インスタンスで共有する不変データなので、そこに向きを持たせると 1 個の反転が全部に波及する。

### 3.4 シミュレーション入出力

```ts
type SimulationInput = {
  pressedSwitches: ReadonlySet<string>   // 操作中（押下中／ON 位置）の componentId・§4.7
  previousEnergizedRelays?: ReadonlySet<string>  // 直前の励磁状態。収束計算の初期値
}

type SimulationStatus = "stable" | "oscillating" | "not-converged"

type SimulationResult = {
  energizedRelays: ReadonlySet<string>   // componentId
  litLamps: ReadonlySet<string>
  netOf: ReadonlyMap<string, number>     // terminalKey() → ネットID
  netState: ReadonlyMap<number, NetState>  // ネットID → 電位状態
  warnings: Warning[]
  status: SimulationStatus
  iterations: number
}

type NetState = {
  reachesPlus: boolean
  reachesZero: boolean
}
```

出力側のコレクションを `Readonly*` にしているのは、UI 側が結果を書き換えてストアと不整合を起こすのを型で防ぐため。エンジン内部では通常の `Set` / `Map` を組み立ててそのまま返してよい。

**`previousEnergizedRelays` を入力に持つ理由（Step 2 で判明）。** 自己保持回路はボタンを離した状態で「全リレー非励磁」と「励磁継続」の**両方が安定解になる双安定回路**であり、どちらに落ちるかは直前の状態でしか決まらない。毎回すべて非励磁から解き直すと、ボタンを離した瞬間に必ず全 OFF 側の解へ落ち、自己保持が原理的に再現できない（検証回路テスト 3・4）。前回の `SimulationResult.energizedRelays` をそのまま渡すことで、UI 側は状態遷移を意識せずに済む。省略時は全リレー非励磁から始める（新規回路・シミュレーション開始時）。

`Warning` は §5.7 の 6 種に対応する。

```ts
type WarningCode =
  | "power-short-circuit"       // +24V と 0V が導通
  | "coil-polarity-reversed"    // コイルに逆極性で電圧
  | "diode-reversed"            // ダイオードの向きが逆（§5.4）
  | "unconnected-terminal"      // どの接続にも現れない端子
  | "oscillating"               // 励磁状態が振動する
  | "not-converged"             // 反復上限に到達

type WarningSeverity = "error" | "warning" | "info"

type Warning = {
  code: WarningCode
  severity: WarningSeverity
  message: string          // UI にそのまま出せる日本語
  componentId?: string
  terminalId?: string
}
```

**`severity` を別に持つ理由:** 発振は配線として正しくても必ず起きる挙動（ブザー回路）であり、エラーとして赤く出すべきではない（§5.5）。コードと深刻度を分けておくと、同じ `oscillating` を「意図した発振なら info、想定外なら warning」と後から出し分けられる。

---

## 4. 部品定義データ（実端子番号）

### 4.1 OMRON MY4N DC24V — 14 ピン（ソケット PYF14A 系）

| 接点 | NC（b接点） | NO（a接点） | COM |
|---|---|---|---|
| 1 回路目 | 1 | 5 | 9 |
| 2 回路目 | 2 | 6 | 10 |
| 3 回路目 | 3 | 7 | 11 |
| 4 回路目 | 4 | 8 | 12 |

コイル: **13 = (−) / 14 = (+)**

`polarity` は `"none"`（極性なし）。公式データシートの結線図では DC モデルの表示灯が**逆並列 LED 2 個**で、コイルも素の電磁石なので、逆接でも励磁し表示灯も点灯する（§4.4）。

**画面上の端子配置。** 実ソケット（PYF14A）の物理ピン配置は模さない。§8 の「実端子番号が視覚的に読み取れることを最優先」に従い、規則性のある配置にする。

| 辺 | 端子 |
|---|---|
| 上 | NC 1・2・3・4 |
| 下 | NO 5・6・7・8 |
| 右 | COM 9・10・11・12 |
| 左 | コイル 14 (+)・13 (−) |

第 i 接点について「上が NC、下が NO、右が COM」で必ず揃い、3 端子は `contactGroup: "c1".."c4"` で束ねられる。上表と同じ 4 行のテーブル（`omron/my-series.ts` の `MY4N_CONTACT_ROWS`）から 12 端子を生成しており、端子表とコードが 1 対 1 に対応する。

**接点端子の座標は端子番号ではなく「何個中の何番目か」から決める**（`spread()`）。4 接点なら 0.2 / 0.4 / 0.6 / 0.8、2 接点なら 1/3 / 2/3 に均等に並ぶ。詰めるのは**表示位置だけ**で、端子番号そのものには触れない（§4.2）。

### 4.2 OMRON MY2N DC24V — 8 ピン（ソケット PYF08A 系）

| 接点 | NC（b接点） | NO（a接点） | COM |
|---|---|---|---|
| 1 回路目 | 1 | 5 | 9 |
| 2 回路目 | 4 | 8 | 12 |

コイル: **13 = (−) / 14 = (+)**

MY4N の 1 回路目と 4 回路目だけを使った配置になっており、8 ピンだが端子番号は 1〜14 の中の 8 個（1・4・5・8・9・12・13・14）が飛び番で振られる。**この飛び番を正しく表示することが本アプリの価値の中核なので、1〜8 に詰め直してはならない。**

**接点の呼び名は詰める。** 端子 4-8-12 は MY4N では「第4接点」だが、MY2N では**第2接点**（`contactGroup: "c2"`）である。端子番号は実機に従い、回路番号は「その部品が持つ接点の何番目か」に従う。混ぜると「2c のリレーに第4接点がある」という読めない表示になる。

### 4.3 OMRON MY4N-D2 DC24V

端子配置は MY4N と同一。コイルに逆起電力吸収ダイオードを内蔵し、**極性を逆にすると内蔵ダイオードが順方向になるため励磁せず、電源短絡状態になる。** `polarity: "strict"` として扱う。

公式データシート（J199 p.5）の MY4(Z)IN-D2(S) 結線図では、13 に `−`、14 に `+` が明記され、内蔵ダイオードは**アノードが 13 側・カソードが 14 側**に入る。標準の MY4N（同 p.5 の DC モデル）には 13/14 の極性印字が無く、この描き分けが -D2 だけ極性を厳守すべき根拠になっている（§4.4）。

**MY4N との定義の差は `polarity` の 1 値だけ。** 端子・接点・コイル電圧はすべて一致する（`registry.test.ts` が両者を突き合わせて保証している）。エンジンはこの 3 値しか見ておらず型番を知らないので、逆接時の挙動の差はデータだけで再現される（§5.3）。

### 4.3.1 MY シリーズ定義の共有（`omron/my-series.ts`）

MY2N / MY4N / MY4N-D2 は端子番号の振り方が同じ系列で、差は **①使う接点行 ②コイルの極性** の 2 点しかない。§4.1 の端子表を型番ごとに手で写すと、片方を直してもう片方を直し忘れた瞬間に「実端子番号が正しい」という前提が崩れる。そこで表を 1 箇所に置き、各型番の定義ファイルは `defineMyRelay()` に引数を渡すだけにした。

| 型番 | 接点行 | `polarity` | `visual` |
|---|---|---|---|
| MY2N | §4.2（2 行） | `none` | 210×220 |
| MY4N | §4.1（4 行） | `none` | 260×240 |
| MY4N-D2 | §4.1（4 行） | `strict` | 260×240 |

**`my-series.ts` にも型番分岐は書かない**（CLAUDE.md 設計原則 2）。型番ごとの差は呼び出し側が渡す引数だけで表現する。系列の違う型番（LY・G2R など）を足すときは、この表を共有せず別のファイルを立てる。

### 4.4 データの確度と検証状態

MY シリーズの端子データは **OMRON 公式データシート（資料番号 J199）と照合済み**。以下が根拠の対応表で、`source` はこの PDF を指す。

| 項目 | 確度 | 根拠 |
|---|---|---|
| MY4N 接点 NC=1-4 / NO=5-8 / COM=9-12 | **検証済み** | J199 p.5 の Terminal Arrangement/Internal Connections (Bottom View)。非励磁状態で可動接点が 1-4 側に接触している図 |
| MY2N 接点 1-5-9 / 4-8-12 | **検証済み** | J199 p.4 の同図。8 ピンでも番号は 1・4・5・8・9・12・13・14 の飛び番 |
| コイル 13=(−) / 14=(+) | **検証済み** | J199 p.1 Model Number Structure の「Coil Polarity (DC case)」**Type 1**（13 = A1 = (−) / 14 = A2 = (+)）。MY2N(S) / MY4N(S) / MY4N-D2(S) がいずれも Type 1 の行に載る |
| MY4N-D2 の内蔵ダイオードの向き | **検証済み** | J199 p.5 の MY4(Z)IN-D2(S) 結線図。13 に `−`、14 に `+` が明記され、ダイオードはアノードが 13 側・カソードが 14 側 |
| MY4N-D2 の逆接時挙動（励磁せず短絡） | 高（推論） | 上記のダイオード向きからの帰結。「逆接すると電源短絡になる」という文言自体はデータシートにない |
| MY2N / MY4N の極性 | **検証済み** | J199 p.4〜5 の DC モデル結線図で、表示灯が**逆並列 LED 2 個**。逆接でも励磁し点灯する → `polarity: "none"`。標準 DC モデルの 13/14 には `−`/`+` の印字が無く、-D2 にだけ付くという描き分けとも整合する |
| 汎用部品（電源 / 押しボタン / 切替スイッチ / ランプ / ダイオード / 端子台）の端子呼称 | 実端子番号ではない | §4.5。実型番を持たないため検証対象そのものが存在しない |

**末尾に「1」が付く型番は極性が逆。** MY2N1 / MY4N1 / MY4N1-D2 は J199 p.1 の **Type 2**（13 = A1 = **(+)** / 14 = A2 = **(−)**）で、Type 1 とコイルの極性が反転している。§4.1 の端子表を流用して「1」付き型番を足すと、検証済みの顔をした誤ったデータになる。系列を追加するときは Type 1 / Type 2 のどちらかを必ず確認すること（CLAUDE.md 設計原則 5）。

**`verified: true` にできるのは実端子番号を公式データシートまたは実機で確認した型番だけ。** MY2N / MY4N / MY4N-D2 は上表の通り確認済み。汎用部品は実端子番号を持たず検証対象が存在しないため `verified: false` のまま据え置く（§4.5）。パレットの「未検証」バッジは `verified: false` **かつ実端子番号を持つ**定義にだけ出るので、この据え置きでバッジは出ない（§4.4 末尾の注記および `hasRealTerminalNumbers()`）。

参考にした資料:
- **[OMRON MY(S) Miniature Power Relays Datasheet (J199) — 公式](https://assets.omron.eu/downloads/latest/datasheet/en/j199_my(s)_miniature_power_relays_datasheet_en.pdf)（端子データの出典）**
- [MY4N DC24 製品ページ — オムロン制御機器](https://www.ia.omron.com/product/item/7507/)
- [MY4N-D2 DC24 製品ページ — オムロン制御機器](https://www.ia.omron.com/product/item/7518/)

### 4.5 汎用部品の端子呼称（電源 / スイッチ / ランプ / ダイオード / 端子台）

この 8 定義は実型番を持たないため、**実端子番号も存在しない。** 実型番の端子番号と混同させないよう、次の扱いで統一する。

| 定義 ID | 型番表示 | 端子ラベル | 役割 |
|---|---|---|---|
| `power-dc24v` | DC24V 電源 | `+24V` / `0V` | `power_positive` / `power_zero` |
| `switch-pushbutton-no` | 押しボタン A接点（モーメンタリ） | `1` / `2` | `common` / `normally_open` |
| `switch-pushbutton-nc` | 押しボタン B接点（モーメンタリ） | `1` / `2` | `common` / `normally_closed` |
| `switch-selector-no` | 切替スイッチ A接点（オルタネート） | `1` / `2` | `common` / `normally_open` |
| `switch-selector-nc` | 切替スイッチ B接点（オルタネート） | `1` / `2` | `common` / `normally_closed` |
| `lamp-dc24v` | DC24V 表示ランプ | `1` / `2` | `generic` / `generic`（極性なし） |
| `diode-generic` | 汎用ダイオード | `A` / `K` | `anode` / `cathode` |
| `terminal-block-6p` | 汎用端子台 6P（全極短絡） | `1` 〜 `6` | すべて `generic` |

ダイオードのラベルを `1` / `2` にしないのは、**この部品では向きだけが情報**だから。番号を振ると「1 が入力」という無い決まりを読ませてしまう。端子台の `1`〜`6` は端子台に振られた通し番号であって、型番ごとに決まった実端子番号ではないため `number` は持たせない（上段 1・2・3 / 下段 4・5・6 に配置する）。

- `TerminalDefinition.number`（実端子番号）は**持たせない**。ラベルはあくまで呼称
- `source` には URL ではなく `definitions/source-notes.ts` の `GENERIC_TERMINAL_SOURCE`（実端子番号ではない旨の定型文）を入れる。`verified` は実型番と同じく `false`

**スイッチ 4 種の定義は `definitions/switches.ts` の `defineSwitch()` に寄せる。** 端子構成・出典・サイズはすべて同じで、差は **①接点種別（NO / NC）②動作（モーメンタリ / オルタネート）③説明文**だけ。表を 4 回書き写すと 1 箇所直し忘れた瞬間に「端子は 1–2 で統一」という上の約束が崩れる（MY シリーズを `defineMyRelay()` に寄せたのと同じ理由・§4.3.1）。`registry.test.ts` の「スイッチ 4 種は端子構成が同一」がこの不変条件を押さえている。

**押しボタンに IEC 慣例の 13-14（a 接点）/ 11-12（b 接点）を当てる案は採らない。** MY4N のコイル 13 / 14 と番号が衝突し、初学者が「実端子番号どうしを繋いでいる」と誤解する。本プロダクトの価値は実端子番号の正しさにあるので、実在しない番号を実在するかのように見せる方が害が大きい。

### 4.6 追加部品の挙動（Step 7 で確定）

Step 7 の 4 部品はいずれも既存のエンジンの分岐（`ElectricalDefinition.kind`）に載るだけで、**`src/circuit/engine/` の差分は 0 行**。挙動は `definitions/__tests__/step7-scenarios.test.ts` で回路を組んで検証する。

| 部品 | 依拠する仕組み | 期待する挙動 |
|---|---|---|
| MY2N | `RelayDefinition.contacts` が 2 要素 | 飛び番の端子で配線でき、励磁で 2 回路が同時に切り替わる。存在しない端子（2・3・6・7・10・11）はネットにも現れない |
| MY4N-D2 | `CoilPolarity: "strict"`（§5.3） | 逆接で励磁せず `error`。同じ配線で MY4N / MY2N は励磁し `warning` に留まる |
| 端子台 | `kind: "terminal"`（§5.1 で union する） | 1 端子に入れた電位が全端子に回る。**導線なので +24V と 0V を渡せば短絡になる** |
| ダイオード | `kind: "diode"`（§5.4 で union しない） | 2 端子は常に別ネット（負荷と同じ扱い） |

**このテストを `engine/__tests__/` に置かないのは意図的。** 検証対象は定義データであってエンジンではなく、engine の差分を 0 行に保つこと自体が Step 7 の完了判定だから（§9）。

**ダイオードの行はその後 §5.4 で更新した。** 有向導通を入れた結果、順方向なら電位を通し、負荷を挟まず電源をまたげば短絡として検出する。union しないこと（2 端子が別ネットのままであること）だけは変わっていない。`step7-scenarios.test.ts` のダイオードのケースも新しい挙動に書き換えてある。

### 4.7 切替スイッチ（オルタネート）

スイッチは **接点（NO / NC）× 動作（`action`）** の 2 軸で、4 定義がすべての組み合わせを埋める。`action` の型（`"momentary" | "maintained"`）は §3.1 の当初から用意してあり、今回は `"maintained"` を実際に使う定義を足しただけ。**`src/circuit/engine/` の差分は 0 行**（§4.6 と同じ主張）。

| 定義 | 静止状態 | 操作すると | 手を離すと |
|---|---|---|---|
| 押しボタン A接点 | 開 | 閉じる | **戻る** |
| 押しボタン B接点 | 閉 | 開く | **戻る** |
| 切替スイッチ A接点 | 開 | 閉じる | **その位置に留まる** |
| 切替スイッチ B接点 | 閉 | 開く | **その位置に留まる** |

#### エンジンは `action` を見ない

`engine/graph.ts` の `conductingPairs()` が見るのは `input.pressedSwitches` に自分の `componentId` が入っているか、という 1 ビットだけで、モーメンタリとオルタネートの区別を持たない。**「手を離しても状態が残るか」は電気的な性質ではなく操作の性質**であり、その差は入力集合の出し入れの仕方でしか現れないからだ。エンジンに `action` の分岐を持ち込むと、集合に入っているのに開いている（あるいはその逆）という第 2 の真実ができてしまう。

したがって差は `simulationStore` に閉じる。

| アクション | 使う定義 | 呼び出し元 |
|---|---|---|
| `pressSwitch` / `releaseSwitch` | モーメンタリ | `pointerdown` / `pointerup`・`pointerleave`・`pointercancel` |
| `toggleSwitch` | オルタネート | `click`（`pointerdown` は伝播を止めるだけ） |

`SimulationInput.pressedSwitches` の意味は「押下中」から **「操作中（押下中／ON 位置）」** へ広がった。フィールド名は据え置いている —— 保存対象ではない実行時の型で、改名しても意味の一貫性以上のものは得られず、エンジン・adapter・テストにまたがる差分に見合わないため。`DeviceSimulationState.pressed` も同様。

#### 停止すると OFF 位置へ戻る

`stop()` は `pressedSwitches` ごとクリアする（§7）。オルタネートを ON にしたまま停止 → 開始すると、**「電源を入れ直したのにスイッチが入ったまま」**になる。実機のセレクタスイッチはそう振る舞うが、ここでは §7 の「停止 → 開始は電源を入れ直す操作」という約束を優先し、位置も初期化する。復帰後の状態を実機に合わせたくなったら、スイッチ位置だけ `circuitStore` 側（保存対象）へ移す判断になる。

#### 図記号で復帰ばねの有無を描き分ける

停止中は操作子ボタンが出ないため、図記号だけでモーメンタリとオルタネートを見分けられなければならない。押しボタンは頭（押しボタンの帽子と破線の操作リンク）で、切替スイッチは**支点と接点の丸**（`.switchPivot`）で描き分ける。頭の有無だけに頼ると、B 接点どうしが停止中に同じ絵になる。

#### プロパティパネル・ツールチップの言い回し

`action` に応じて「押下中 / 復帰」ではなく **「ON 位置 / OFF 位置」** と出す（`PropertiesPanel` の「操作」行と `lib/component-display.ts` の `deviceStatusOf()`）。同じ「押下中」と表示すると、手を離しても状態が残ることが文言から読めない。

---

## 5. シミュレーションエンジン

### 5.1 中核となる考え方

すべての導通要素を**端子ノードの無向グラフ**として扱い、Union-Find（DSU）で連結成分＝「ネット」を求める。

**union する（導通する）もの:**

- 配線（`CircuitConnection`）
- 端子台の全端子どうし
- CLOSED 状態のスイッチの 2 端子
- CLOSED 状態のリレー接点（非励磁なら COM–NC、励磁なら COM–NO）

**union しない（導通しないもの）:**

- リレーコイルの 2 端子
- ランプの 2 端子
- ダイオードの 2 端子（導通はするが union はしない。有向なので §5.4 の電位伝搬で表す）

### 5.2 なぜ負荷を union してはいけないか

コイルやランプを導線として union すると、`+24V → コイル → 0V` を組んだ時点で +24V 端子と 0V 端子が同一ネットになり、電源短絡の誤検出が発生する。負荷は「両端が異なる電源ネットに属するか」で判定する対象であって、導通経路ではない。**これは本エンジン最大の落とし穴なので、実装時に必ずコメントを残すこと。**

### 5.3 コイル励磁の判定

```ts
const plus = (t: string) => netState(t).reachesPlus && !netState(t).reachesZero
const zero = (t: string) => netState(t).reachesZero && !netState(t).reachesPlus

const p = coil.positiveTerminal, n = coil.negativeTerminal
const forward = plus(p) && zero(n)
const reverse = zero(p) && plus(n)

switch (coil.polarity) {
  case "none":      energized = forward || reverse   // MY2N / MY4N
                    indicatorOn = forward || reverse // 逆並列 LED なので逆接でも点灯
                    break
  case "indicator": energized = forward || reverse
                    indicatorOn = forward
                    if (reverse) warn("極性が逆です（表示灯が点灯しません）")
                    break
  case "strict":    energized = forward             // MY4N-D2
                    if (reverse) warn("コイルの極性が逆です") // 内蔵ダイオード順方向
                    break
}
```

`polarity` を 3 値にしたのは、実機の挙動が「励磁するか / しないか」の 2 値ではないため。MY4N-D2 は逆接で励磁しないが、MY2N / MY4N は逆接でも励磁し表示灯も点く。この差を再現できることが「実機を配線する前の確認」というプロダクト価値に直結する。**エンジンには型番分岐を書かず、この 3 値だけで分岐する。**

**`indicator` は現時点でどの定義も使っていない。** 単方向 LED を持つコイル（逆接で励磁はするが表示灯が点かない）のための値で、MY シリーズは §4.4 の照合の結果すべて `none` か `strict` に落ち着いた。値を残しているのは、この挙動が実在する部品の挙動であり、対応部品を足すときにエンジンを触らず定義 1 枚で済ませるため（CLAUDE.md 設計原則 2）。MY2N / MY4N の挙動と混同しないこと。

### 5.4 ダイオードの扱い（有向導通・`engine/diode.ts`）

単体ダイオードは一方向にしか導通しないため、無向グラフである DSU では原理的に表現できない。**そこで DSU は変えない —— ダイオードの 2 端子は今も union しない**（§5.2 の負荷と同じ扱い）。代わりに、ネットを組み終えた後の**電位の伝搬をアノード → カソードの一方向にだけ流す**。これが旧版で予告していた「2 パス探索」で、`computeNetStates()` の末尾で 1 回行う。

| 伝わるもの | 向き |
|---|---|
| `reachesPlus` | アノード側ネット → カソード側ネット（順方向探索） |
| `reachesZero` | カソード側ネット → アノード側ネット（0V からの後方到達可能性） |

ネットの分割そのものは変わらないので、**コイル（§5.3）とランプの判定規則は 1 行も変わらない。** `+24V → D → ランプ → 0V` は点灯し、D を逆に挿すと点灯しない。

#### 逆起電力吸収（還流）ダイオード

リレーコイルは誘導負荷で、消磁の瞬間に電源電圧の数十倍の逆起電力（サージ）を出す。これを吸収するのがコイルと**並列**に、**カソードをコイルの + 側へ**向けて入れるダイオード。本エンジンは時間を持たない（§6-4）ためサージそのものは再現できないが、**役割と向きの正誤は再現できる。**

| 配線 | 静止時 | 通電時 | 判定 |
|---|---|---|---|
| K がコイル + 側（正しい） | 逆バイアス・開放 | 逆バイアス・開放 | 回路の動作を一切変えない |
| A がコイル + 側（逆挿し） | 逆バイアス | **順方向 → コイルと並列の短絡経路** | `diode-reversed`（error）＋ 電源短絡。コイルは励磁しない |

**逆挿しは通電前から警告する。** 短絡するのは接点が閉じた後だが、誤りなのは配線であって通電のタイミングではない。`detectDiodeOrientation()` は「ダイオードの 2 端子が、あるコイルの 2 端子と同じネット対にいるか」を `netOf` だけで見るので、電流が流れていなくても検出できる。この判定はプロパティパネル（§8.3）も同じ関数（`inspectDiodes()`）から読む。

**単に逆向きで電流を遮断しているだけのダイオードは警告しない。** 逆流防止として意図的に入れる配線と区別できないため。パネルには「逆方向（遮断）」と状態が出る。

MY4N-D2 の**内蔵**ダイオードはここには乗らない。部品として置かれていない以上ネットに現れないので、従来どおり `CoilPolarity: "strict"`（§5.3）だけで表現する。

### 5.5 収束ループ

実装は `MAX_ITERATIONS`（`src/lib/app-info.ts`）を参照する。

```ts
function simulate(doc, defs, input): SimulationResult {
  // 直前の励磁状態から始める。全 OFF から解き直すと自己保持が再現できない（§3.4）
  let energized = new Set(input.previousEnergizedRelays ?? [])
  const history: string[] = []

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const graph = buildGraph(doc, defs, input, energized)  // §5.1
    const nets  = computeNets(graph, doc, defs)            // reachesPlus/Zero
    const next  = evaluateCoils(nets, doc, defs)           // §5.3

    if (sameSet(next, energized)) {
      return { status: "stable", iterations: i + 1, ... }  // 収束
    }

    const key = signature(next)
    if (history.includes(key)) {
      return { status: "oscillating", ... }  // 発振を検出
    }
    history.push(key)
    energized = next
  }
  return { status: "not-converged", ... }
}
```

**発振の検出について:** B 接点による自励発振（ブザー回路）は、配線として正しくても必ず起きる。反復上限だけで判定すると正しい回路を「不正な接続」と誤って警告してしまうため、励磁状態のシグネチャ履歴を持ち、同じ状態が再出現したら `oscillating` として区別する。UI では「この回路は発振します（ブザー動作）」と、エラーではなく挙動として提示する。

**返す状態は「最後にグラフを組んだときの励磁状態」。** `oscillating` で打ち切った場合、接点の開閉状態と `energizedRelays` が食い違うと UI の表示が矛盾する。そこで各反復のスナップショット（グラフ構築に使った励磁状態・ネット・警告）を保持し、打ち切り理由によらずその組をそのまま返す。`stable` の場合は次状態と一致しているので差は出ない。

**インターロックと同時押し。** 相互 b 接点のインターロック回路で全 OFF から 2 つの起動ボタンを同時に押すと、「両方励磁 → 両方消磁」を繰り返して `oscillating` になる。これは実機でも競合する条件であり、誤判定ではない。片方が先に励磁していれば（`previousEnergizedRelays` 経由で伝わる）1 反復で `stable` に収束する。

### 5.6 配線色の決定（要件書 §8 の具体化）

各ネットの `{ reachesPlus, reachesZero }` から決める。

| reachesPlus | reachesZero | 表示 |
|---|---|---|
| false | false | グレー（非通電） |
| true | false | 赤（+24V 側） |
| false | true | 青（0V 側） |
| true | true | — （§5.7 の電源短絡。下記の通り緑ではない） |

色だけに依存しないよう、通電中は線幅と発光表現を併用する（要件書 §8）。

**「緑＝通電中」は 2 ビットだけでは決まらない（Step 2 で判明）。** 負荷をグラフ上で union しない設計（§5.2）の下では、`reachesPlus && reachesZero` が成立するネットは +24V 端子と 0V 端子が直結された状態、すなわち **§5.7 の電源短絡そのもの**になる。正常な回路にこのネットは現れない。したがって Step 4 の配線色は次のように決める。

| 条件 | 表示 |
|---|---|
| どちらにも到達しない | グレー（非通電） |
| + 側のみ | 赤 |
| 0V 側のみ | 青 |
| **通電中の負荷（励磁コイル・点灯ランプ）に隣接するネット** | 緑・太線・発光 |
| 両方に到達 | 電源短絡として警告表示（赤の点滅など、通電とは別扱い） |

緑は「電流が流れている経路」であり、判定には負荷側の結果（`energizedRelays` / `litLamps`）が要る。エンジンはネットの 2 ビットを返すところまでを責務とし、緑の割り当ては UI 層（Step 4）で行う。

**Step 4 での実装。** `adapter/simulation-view.ts` の `WireState`（5 値）に落とす。

```ts
type WireState = "inactive" | "plus" | "zero" | "energized" | "self-hold" | "short"
```

| 値 | 条件 | 表示 |
|---|---|---|
| `inactive` | どちらにも到達しない | グレー・2px・不透明度 0.45（§5.8 の `isolated` と一致する線は破線・不透明） |
| `plus` | + 側のみ | 赤・2px・不透明度 0.55 |
| `zero` | 0V 側のみ | 青・2px・不透明度 0.55 |
| `energized` | 通電中の負荷に隣接するネット | 緑・3.5px・発光 |
| `self-hold` | 通電中のうち、自己保持しているリレー自身の接点が支えている枝（§5.9） | 紫・3.5px・流れる破線 |
| `short` | 両方に到達 | 赤・3.5px・点滅 |

判定順は **`short` を最初に置く。** 短絡したネットを緑（正常な通電）として描くと、最も危険な配線ミスが最も安全に見える。`self-hold` は **`energized` の中からだけ切り出す**（同じ理由で `short` を上書きしない）。

「通電中の負荷に隣接するネット」は、励磁したコイルの `positiveTerminal` / `negativeTerminal` と、点灯したランプの 2 端子が属するネットを集めて求める。負荷は union されていない（§5.2）ので、電流の経路はこの 2 点からしか辿れない。

同じ `WireState` を**端子の色にも使う。** 端子を無彩色のままにすると、接点の先で色が途切れて配線が切れているように見える。

#### 電流が流れていない線の描き分け

実行中に「流れていない」状態は 3 種類あり、意味が違う。

| 状態 | 意味 | 読み手がすべきこと |
|---|---|---|
| `plus` / `zero` | 電圧は来ているが戻り経路が無い | 何もしなくてよい（正常な待機） |
| `inactive` | 今はどちらの電源も届いていない | 接点が閉じれば流れる。動かして確かめる |
| `inactive` かつ §5.8 の `isolated` | どう動作させても届かない | **配線漏れを疑う** |

**「電流が流れているか」は色相ではなく、太さと濃さの 1 本の軸に載せる。** 通電中（緑・紫）だけが太く不透明で、待機している線は濃さを落とす。色相の違いだけに頼ると、色覚特性によっては「今できている閉回路」がまったく読み取れない —— 要件書 §8 の「色だけに依存しない」を、通電側（太線・発光）だけでなく非通電側にも徹底する。図面を開いた瞬間に生きている閉回路が浮き上がり、赤・青の待機線は「電圧はここまで来ている」という情報を保ったまま背景へ下がる。

**選択中・ホバー中は濃さを必ず戻す。** 掴んだ線が薄いままだと、束の中の 1 本を端から端まで追えない（§8.7 の目的そのものが失われる）。

**配線漏れの破線は実行中も残す。** §5.8 の `isolated` を実行中にも引き、**色ではなく破線というパターンだけ**を借りる。実行中の色は電位の意味を持つので役割色は混ぜられないが、破線なら「電源が届いていない」の意味を停止中と共有できる。これが無いと、実行した瞬間に配線漏れの手がかりが消えて、動かない原因を探すことになる。

**配線漏れの線だけは濃さを落とさない。** 非通電の中で唯一「直すべき線」であり、画面で最も薄い線にしてしまうと気付かせる役目を果たせない。結果として停止中とまったく同じ見た目（灰・破線・不透明）になり、実行しても配線漏れの読み方が変わらない。

ただし破線を足すのは **`inactive` と `isolated` が一致したときだけ。** 役割の判定は静止 / 全動作の 2 状態しか見ない近似なので（§5.8）、A 接点と B 接点が直列に入った線などを `isolated` と誤ることがある。今まさに電位が乗っている線に「配線漏れ」の破線を引くのは明白な矛盾になるため、食い違ったら現在の状態を優先する。

### 5.7 警告の検出（validation.ts）

| 警告 | `WarningCode` | 既定の `severity` | 検出方法 |
|---|---|---|---|
| 電源短絡 | `power-short-circuit` | error | +24V 端子のネットが `reachesPlus && reachesZero`（ネット ID の一致では見ない —— ダイオード経由の短絡は別ネットのままなので） |
| コイル極性逆 | `coil-polarity-reversed` | `strict` は error / `indicator` は warning（`none` は出さない） | §5.3 の `reverse` 判定 |
| ダイオード逆向き | `diode-reversed` | error | コイルと並列で A がコイル + 側、または負荷を挟まず順方向で + と 0V をまたぐ（§5.4） |
| 未接続端子 | `unconnected-terminal` | info | どの `CircuitConnection` にも現れない端子 |
| 発振 | `oscillating` | info | §5.5 の履歴一致 |
| 収束しない | `not-converged` | error | 100 回反復して安定しない |

#### 静的な配線チェック（`engine/wiring.ts`・停止中）

▶ を押すまで指摘が 1 件も出ないのは、**「実機を配線する前に確認する」というこのプロダクトの目的からするとひとつ遅い。** 未接続の端子も、還流ダイオードの逆挿しも、電源の直結も、通電させる前から配線図の上で決まっている。

`inspectWiring(document, definitions)` は **静止状態**（どのスイッチも操作されておらず、どのリレーも励磁していない）のネットを 1 回だけ構築し、上表のうち次の 3 つを返す。収束ループは回さず、状態も `SimulationResult` も持たない。

| 含める | 理由 |
|---|---|
| `unconnected-terminal` | ネットすら見ない純粋に静的な指摘 |
| `power-short-circuit` | 静止状態で + と 0V が繋がっているなら、通電の有無に関係なく配線の誤り。**B 接点は静止状態で閉じている** —— 押していないから安全、ではない |
| `diode-reversed` | 還流ダイオードの向きは「コイルと並列にどちら向きに入っているか」で決まる。`validation.ts` が明言しているとおり通電の有無を見ない |

| 含めない | 理由 |
|---|---|
| `oscillating` / `not-converged` | 収束の結果そのものについての指摘。反復を回さないここには原理的に存在しない |
| `coil-polarity-reversed` | 極性の判定（`evaluateCoil`）は「コイルの両端にかかっている電位」で定義されている。静止状態では接点の向こう側のコイルに電位が届かず、**同じ誤配線が出たり出なかったりする。** 出方が安定しない指摘は「出なかった＝正しい」と読まれるぶん害があるので ▶ の診断に任せる |

**指摘が無いことは配線が正しいことを意味しない。** 押して初めて成立する短絡（A 接点越しの直結）はここには出ない。UI 側でそう言い切ること（§8.4）。`wiring.test.ts` は出ることと同じ数だけ **出ないこと**（A 接点越しの短絡・発振・極性）を押さえている。

**実行中は呼ばない。** ▶ の診断のほうが厳密に多くを見ており、両方並べると同じ未接続端子が二重に出る（§8.4）。

### 5.8 停止中の役割配色（`adapter/wire-role.ts`）

§5.6 の `WireState` は **シミュレーション中**の色であり、停止中はすべて灰色になる。だが図面を描いている時間の大半は停止中で、その間まったく色の手がかりが無い。ここでは実務の盤配線と同じ考え方 —— 常時 + 側は赤、0V は青、接点を介して電源につながる制御線は黄 —— を、**回路を動かさずに**割り当てる。

判定は **3 回のネット構築**（§5.1）だけで済む。`simulate()` の収束ループ（§5.5）は回さない。

| 呼び出し | `pressedSwitches` | `energizedRelays` | 読み取れること |
|---|---|---|---|
| 静止状態 | 空 | 空 | 電源に直結している線（赤 / 青） |
| 起動の瞬間 | 全部品の ID | 空 | 接点を閉じれば電源に届く線（黄） |
| 全動作状態 | 全部品の ID | 全部品の ID | 同上 |

静止状態以外も取るのは、**A 接点の先の線が静止状態ではどの電源にも到達せず、「配線し忘れた線」と区別できない**ため。どれでも届かない線だけが灰になるので、**灰は「まだ電源につながっていない」の意味を持つ**（配線漏れの手がかりになる）。B 接点は動作させると開くので、静止状態で電源に届く線は赤 / 青のままになる。

**「起動の瞬間」を独立させたのは b 接点の直列チェーンのため（実回路で誤検出を確認して追加）。** インターロックや先行優先の回路は、「どのリレーも励磁していない間だけ導通する起動経路」を b 接点で組む。静止状態と全動作状態の 2 点だけでは、全動作状態で b 接点がすべて開いてチェーンが丸ごと死ぬため、**正しく描かれた起動経路がまるごと配線漏れに見える。** 3 リレーの先行優先回路で 10 本の正常な配線が `isolated` と判定された。「スイッチは入っているがリレーはまだ動いていない」という起動の瞬間を 1 つ足すだけで、この誤検出は消える。

到達性は**どれか 1 つの状態で届けば `control`。** 灰は「直すべき線」の合図なので、迷ったら灰にしない側へ倒す —— 正しい線を疑わせる誤検出のほうが、見逃しよりも害が大きい。それでも 3 状態は近似であり、「あるリレーが励磁し、かつ別のリレーは非励磁」でしか電源に届かない線は `isolated` に落ちうる。実行中はこれを §5.6 のガード（現在の状態が `inactive` のときだけ破線）で受け止める。

`buildNets` は部品の `kind` に応じた集合しか見ないので、押下スイッチと励磁リレーのどちらにも全 ID を渡してよい。**この 1 点により、役割配色の側に部品種別の分岐が要らない。** 集合を 2 つに分けているのは、上記の「起動の瞬間」を作るためだけ。

| `WireRole` | 条件（判定順） | 表示 |
|---|---|---|
| `short` | 静止状態で + と 0V の両方に到達 | 赤・3.5px・点滅（§5.6 と同じクラス） |
| `plus` | 静止状態で + 側のみ | 赤 |
| `zero` | 静止状態で 0V 側のみ | 青 |
| `control` | 全動作状態でどちらかの電源に到達 | 黄（`--wire-control`） |
| `isolated` | どちらでも到達しない | 灰・破線 |

判定順が §5.6 と同じく **`short` 先頭**なのも同じ理由 —— 最も危険な配線ミスを最も安全な見た目にしない。停止中に見つけた短絡を大人しい色にすると、実行した瞬間に色が変わって初めて気付くことになる。

**役割色と状態色は排他。** 実行中（`SimulationResult` がある間）も役割は計算するが、**色として使うのは停止中だけ。** 実行中に借りるのは `isolated` の 1 ビットを破線というパターンに使うところまでで（§5.6）、§5.6 の状態色以外の色は載せない。同じ線に 2 つの意味が同時に乗ると、色が「役割」なのか「今の電位」なのか読み手が判断できない。+ 側 / 0V 側だけは両方で同じ赤・青を使う（停止と実行で同じ線の色が変わらない）。

**負荷は役割配色でも union しない**（§5.2）。ランプを跨いだ先の線は `plus` にならず、`control` か `isolated` になる。

**凡例（`WireLegend.tsx`）。** 赤＝+ 側・青＝0V は実務と同じで説明が要らないが、**灰の破線＝どこにも電源が届いていない、は読み取れない。** 凡例が無いとこの色分けは「なんとなく色が付いている」で終わるため、配線が 1 本以上あるときキャンバス右下に出す。**中身は停止中と実行中で入れ替える** —— 停止中は役割（赤 / 青 / 黄 / 灰破線）、実行中は状態（緑 / 紫破線 / 薄い赤 / 薄い青 / 薄い灰破線・§5.6・§5.9）。読み取れない 1 色（停止中は灰破線、実行中は紫破線）を説明するのが凡例の役目なので、色の意味が切り替わるなら凡例も切り替える。実行中は**通電している 2 つを先頭に置く** —— 最初に読ませたいのは「今どこに電流が流れているか」で、待機線はその後でよい。

**見本線は実際の描かれ方を写す。** 実行中の待機線はキャンバス上で濃さを落としてあるので、凡例の見本も同じだけ薄くする。「薄い＝電流が流れていない」という軸そのものが読み取らせたい情報であり、見本だけ濃く描くとその軸が凡例から抜け落ちる。

### 5.9 自己保持の検出（`adapter/self-hold.ts`）

§5.6 の配線色は「今この線に電源が届いているか」までしか言わない。だが自己保持回路を読むときに知りたいのは **「今このリレーを保持しているのは誰か」** —— 押しているボタンなのか、自分の接点なのか —— であり、電位からは読み取れない。ボタンを押している間も離した後も、コイルの + 側は同じ緑になる。本プロダクトが最初に教える回路が自己保持である以上、ここが見えないのは痛い。

**判定は「もしこのリレーが落ちたら、そのまま落ちたままか」。** 落ちたままなら、今その励磁を支えているのは自分自身の接点しかない。これが自己保持の定義そのものである。

問い方は `simulate()` の再実行 1 回。`previousEnergizedRelays` から対象のリレーだけを抜いた状態（＝そのリレーの接点も一緒に開いた状態）で解き直す。

| what-if の結果 | 意味 |
|---|---|
| 抜いたリレーが戻ってくる | ボタンなど**外部**が保持している（自己保持ではない） |
| 抜けたまま落ちる | **自分の接点**が保持していた（自己保持） |

収束ループ（§5.5）をそのまま使うので、A が B を保持し B が A を保持する連鎖も自然に扱える（1 個落とせば芋づるに落ちる）。自分の b 接点でコイルを駆動する自励発振は「落としても戻ってくる」側になり、自己保持とは区別される（発振は §5.5 が警告として出す）。

**押している間は自己保持と呼ばない。** 起動ボタンを押したままなら what-if でもリレーは戻ってくる。したがって色が変わるのは**ボタンを離した瞬間**であり、この切り替わりそのものが「今、保持が接点へ移った」ことを示す。

#### 保持経路 ＝ 保持ループ（切れば落ちる線）

紫の意味は凡例が言い切っているとおり **「この線を切るとリレーが落ちる」**。したがって塗るのは保持ループの一周 —— 電源 → コイル → 自分の接点 → 電源 —— であり、`SelfHoldView` は端子（`terminals`）と**配線（`connections`）を別々に持つ**。

**ネットからは求まらない。** ネットは連結成分までしか持たず「どの端子どうしが直接つながっているか」を失っているので、同じネットの中で「保持している線」と「行き止まりの線」を区別できない。そこで `SimulationResult` とは別に、今この瞬間の**経路グラフ**を組み直す。

1. 辺の作り方は `buildNets()` と同じ ——電線と、閉じている接点・スイッチ・端子台だけを結び、負荷は結ばない（§5.2）。接点の開閉規則を書き直さないよう、エンジンの `conductingPairs()` をそのまま呼ぶ
2. 電源の + 端子すべてを仮想ノード `@plus`、0V 端子すべてを `@zero` に束ねる
3. グラフの**橋**（切ると連結成分が割れる辺）を Tarjan の低リンク法で求める
4. 2 辺連結成分を 1 点に潰すと橋だけを辺に持つ**木**になる。`コイル + → @plus` と `コイル − → @zero` の 2 本の道に載る橋が、そのまま保持ループ

コイルは union されていない（§5.2）ので、2 と 4 の「2 本の道」を別々に辿って初めて一周になる。どちらの端子が + 側かは定義ではなく実際のネット状態から読む —— 極性なしのコイル（MY2N / MY4N）は逆接でも励磁するため（§5.3）。

**以前は「コイル側の枝だけ」に絞っていた**（what-if で電源を失う端子だけを残す方法）。これは凡例の約束と食い違っていた。

| 線 | 旧ルール | 実際に切ると |
|---|---|---|
| 自己保持接点 → 停止ボタン → 0V の帰り道 | 塗らない（接点が開いても 0V に届いたままなので枝ではない） | **落ちる** |
| 開いている起動ボタンへ伸びる線 | 塗る（同じネットで、接点が開けば電源を失うので） | **落ちない**（行き止まり） |

つまり旧ルールは保持ループの半分だけを塗り、代わりに切っても落ちない線を塗っていた。電源からの幹線を紫にすると「切れば落ちる線がぼやける」という懸念で幹線を外していたが、幹線も切れば落ちる以上、外すと嘘になる。**ぼやけるのを避けるために間違ったものを塗るくらいなら、一周を正しく塗る。**

配線の色は端子から引けない。保持ループから行き止まりが枝分かれしていると、同じ端子から出た 2 本のうち一方だけが紫になるため（§5.6 の他の色は従来どおり `from` 側の端子から引く）。

近似が残るのは 2 点。どちらも「切れば落ちる」側に倒れることは無く、塗り漏れになる。

- **並列に張った 2 本**はどちらも橋にならないので塗られない。実際どちらか 1 本を切っても落ちないので、色としては正しい
- **保持ループがダイオードを跨ぐ**場合、ダイオードは導通辺として持たない（§5.4 の有向な電位伝搬でしか表せない）ため、その先が切れる

#### 置き場所と負荷

`simulate()` を励磁中のリレーの数だけ追加で回すため、**表示状態の組み立て（`buildSimulationView`）とは別の関数・別の `useMemo`** に分ける。混ぜると色を引くたびに回路を解き直すことになる。実際に走るのは `SimulationResult` が変わったときだけで、部品をドラッグしただけの再描画では走らない。

経路グラフと橋の計算は**リレー 1 個ごとではなく 1 回だけ**。閉じている接点の集合は回路全体で 1 つなので、リレーごとに変わるのは「どこからどこへの道を辿るか」だけになる。計算量は端子数・配線数に対して線形。

エンジン（`circuit/engine/`）ではなく adapter に置くのは §5.8 と同じ理由 —— これは電気的な真実ではなく**読み手のための切り分け**であり、`SimulationResult` から後段で導ける。エンジンの責務はネットの 2 ビットと励磁集合までで閉じる。

#### 表示

| 対象 | 表示 |
|---|---|
| 保持経路の配線 | 紫・3.5px・流れる破線（`--wire-self-hold`）。破線を併用するのは色覚に依存させないため |
| 保持経路の端子 | 同じ紫（端子だけ緑に残すと接点の手前で色が途切れる） |
| 自己保持中のリレー | ノードを紫で縁取る。ホバーのステータスも「励磁中」ではなく「自己保持中」 |
| プロパティパネルの端子一覧 | 端子番号のチップを紫、状態欄に「自己保持」 |
| プロパティパネルのコイル状態 | 「励磁中」ではなく「自己保持中」 |

選択中のノードでは縁取りを譲る。選択の枠（`--accent`）は今まさに操作している対象を指すもので、状態表示に奪われると何を掴んでいるのか分からなくなる。

---

## 6. 既知の制約（MVP で許容する）

1. **負荷の直列接続は再現できない。** `+24V → L1 → L2 → 0V` では両方消灯になる（現実には両方が薄暗く点灯）。中間ネットがどちらの電源にも到達しないため。実務のリレー回路ではまず組まない配線であり、要件書 §30 の「電圧計算」フェーズで解決する。
2. **ダイオードは順逆の別と向きの誤りまで（§5.4）。** 導通の向き・還流ダイオードの向きの正誤・順方向短絡は再現するが、**逆起電力のサージそのものは再現しない**（時間の概念が無いため。下記 4 と同じ理由）。順電圧降下（約 0.7V）も扱わない。
3. **電圧・電流・消費電力の数値は扱わない。** 導通の有無のみ。定格電圧の不一致（DC24V ランプに AC100V など）は MVP では検出しない。
4. **時間の概念がない。** タイマーリレー、接点のチャタリング、動作／復帰時間は扱わない。発振回路は「発振する」と判定するのみで、周期は再現しない。
5. **同時に変化する入力の競合は解けない。** すべてのコイルを一斉に評価するため、相互 b 接点のインターロック回路で全 OFF から 2 つの起動ボタンを同時に押した場合、実機のように「わずかに早い方が勝つ」のではなく `oscillating` になる（§5.5）。動作時間を持たない以上、どちらが勝つかを決める根拠が無い。
6. **範囲選択の配線判定は両端子を結ぶ直線で行う**（§8.6）。実際の描画は `smoothstep` の折れ線なので、大きく回り込んだ配線では見た目の線と判定線がずれる。実路を使うには描画後の DOM を測る必要があり、判定を純粋関数として検証できなくなる。
7. **`simulate()` は履歴を持たない純粋関数。** 自己保持のような双安定回路の状態は呼び出し側が `previousEnergizedRelays` で繋ぐ（§3.4）。渡し忘れると自己保持が毎回解けてしまうため、`simulationStore` 側で必ず前回結果を渡すこと。

これらは**ヘルプの「このシミュレーターが扱わないこと」に出す**（§8.10）。本文は `lib/help-content.ts` の `LIMITATIONS` が持っており、**この節を直したらそちらも直す**（逆も同じ）。黙っていると、仕様上そうなる挙動（直列につないだランプが両方消灯する等）をユーザーはバグとして受け取る。

---

## 7. 状態管理

### circuitStore（保存対象＋履歴）

`CircuitDocument` 相当を保持する。Undo/Redo は `{ past: Doc[]; present: Doc; future: Doc[] }` を自前で持ち、**操作完了時にのみコミットする。**

React Flow のノード移動は毎フレーム `onNodesChange` を発火するため、変更を素直に履歴へ積むと 1 回のドラッグで数百件の履歴が生まれる。`onNodeDragStop` / 配線確定 / 部品追加 / 削除 のタイミングでのみスナップショットを取る。

#### Undo / Redo の実装（Step 6 で確定）

**ドラッグはスナップショットを「開始時」に控え、「完了時」に積む。** `onNodeDragStop` の時点で現在のドキュメントを past へ積むと、戻る先が移動後の位置になり Undo が効かない。`beginComponentDrag()` がドラッグ開始時のドキュメントを控え、`endComponentDrag()` が **位置が実際に変わっていた場合だけ** それを past へ積む。掴んだだけの操作で履歴を汚さない。

控えたドキュメントは **ストアの state ではなくモジュール変数**に置く。履歴でも保存対象でもない一時値であり、`document` の購読者をドラッグのたびに起こす理由が無い。

**削除の入口は `removeElements(componentIds, connectionIds)` の 1 本だけ。** 要素ごとに消せる API を残すと、範囲選択で 5 個消したときに履歴が 5 手ぶん積まれ、1 回の削除を戻すのに Undo を 5 回押すことになる。部品と配線を 1 回の `set` で落とす。`removeSelected()` もこれに委譲する。

**部品の交換（`replaceComponentDefinition(componentId, definition)`・Step 9 で確定）。** 配置済みの部品を「接続を維持したまま」別の定義に差し替える（例: A 接点スイッチ → B 接点スイッチ、MY4N → MY2N）。接続 (`CircuitConnection`) はインスタンス ID（`componentId`）と端子 ID（`terminalId`）で端子を指しており、部品そのものの座標や種類は見ていない。そのため差し替えでやることは実質 2 つだけになる。

1. 対象インスタンスの `definitionId` を新しい定義の ID に書き換える（`id` / `label` / `position` / `flipped` はそのまま）
2. 新しい定義の端子 ID 集合に**存在しない**端子を指す配線だけを間引く

A 接点 → B 接点のように端子 ID がそのまま一致する差し替えでは配線は 1 本も切れない。MY4N → MY2N のように接点が 4 → 2 に減る差し替えでは、無くなった端子（2, 3, 6, 7, 10, 11）を指していた配線だけが黙って外れ、共有される端子（1, 4, 5, 8, 9, 12, 13, 14）の配線は残る（`omron/my-series.ts` が端子 ID を共有しているためエンジン側の対応は不要）。

**交換候補は同じカテゴリ内に限定する**（UI 側 `PropertiesPanel` の絞り込み）。カテゴリを跨ぐ差し替え（スイッチ → ランプ等）は `ElectricalDefinition.kind` ごと変わり、部品交換ではなく作り直しに等しいため候補に出さない。

**外れた配線は通知せず黙って削除する。** 範囲選択の削除と違って対象が 1 部品・数本規模であり、プロパティパネルの端子一覧を見ればどの端子が無くなったかすぐ分かるため、追加の通知 UI は置かない。

履歴は 1 手。差し替え先の部品が見つからない・現在と同じ定義への差し替えは空振りとして履歴を汚さない。選択中の配線が交換で外れた場合は選択からも外す（`removeElements` と同じ `retained()` を使う）。

**React Flow から届く削除も 1 回にまとめる。** React Flow は削除を「Edge の remove 変更」と「Node の remove 変更」に分けて `onEdgesChange` / `onNodesChange` へ流すので、変更ハンドラー側で消すと同じことが起きる。`CircuitCanvas` は remove 変更を無視し、**両方が揃った状態で 1 回だけ呼ばれる `onDelete`** で `removeElements()` を呼ぶ（§8.6）。

**選択の一括差し替え（`setSelectedComponents` / `setSelectedConnections`）。** 範囲選択中は毎フレーム選択集合を組み立て直すため、1 個ずつのトグルでは枠を縮めたときに外れた要素が残る。中身が同じなら同じ配列参照を返し、再描画を止める（MY4N 1 個で端子 14 個ぶんの描画が走る）。

**ビューポートは履歴に含めない。** `viewport` は `CircuitDocument` の一部（＝保存対象）だが、パン・ズームは「取り消したい操作」ではない。Undo / Redo は復元したドキュメントに **現在の** `viewport` を載せ替えるので、戻した瞬間にキャンバスが飛ぶことがない。ラベル編集（`setComponentLabel`）も 1 文字ごとに発火するため積まない（§8.3）。

**`replaceDocument()` は履歴と選択をリセットする。** 保存データの読み込み前へ Undo で戻れると、「復元した」のか「壊した」のか区別できなくなる。

履歴の上限は 50 手。1 手あたりドキュメントを丸ごと持つため、部品数 × 手数だけメモリを使う。

#### 永続化（`circuit/persistence/document-storage.ts`・Step 6 で確定）

保存対象は `CircuitDocument` だけで、実行時状態（`running` / `pressedSwitches` / `SimulationResult`）は保存しない。キーは `relay-lab:circuit:v1` で、末尾は `CircuitDocument.version` と対応させる（書式を変えたら上げる＝旧データを読まない）。

**読み込みは常に「壊れているかもしれないデータ」として扱う。** 保存後に定義 ID が変わった／端子が減ったといった事情で、実在しない部品や端子を指す JSON はいくらでも生まれる。素通しするとエンジンが存在しない端子のネットを引いて静かに壊れるため、`parseDocument()` が次を弾く。

| 対象 | 判定 | 結果 |
|---|---|---|
| 全体 | JSON として読めない / `version` が 1 でない / `components`・`connections` が配列でない | ドキュメントごと不採用（`invalid`） |
| 部品 | ID が無い・重複・レジストリに無い `definitionId`・座標が数値でない | その部品を落とす |
| 部品の `flipped` | `true` 以外（欠損・型違い） | **部品は落とさず**「反転なし」へ倒す |
| 配線 | 端子参照が不正・両端の部品または端子が実在しない・ID 重複・同一端子ペアの重複 | その配線を落とす |
| ビューポート | 数値でない / `zoom <= 0` | 既定値へ戻す |

**落としたものは理由付きで返す。** 黙って捨てると、回路が欠けた理由をユーザーが知る手段が無くなる。`{ status: "loaded", document, dropped: string[] }` の `dropped` をそのまま画面に出す（§8.4）。

**「保存が無い」と「壊れている」を同じ扱いにしない。** 前者は初回起動そのものであり、通知を出す場面ではない。

#### ファイルへの書き出し・読み込み（`circuit/persistence/document-file.ts`）

LocalStorage の自動保存は**このブラウザの中だけ**の話で、別の PC へ回路を渡す手段が無かった。回路を 1 枚のファイルとして持ち出す経路を足す（UI は §8.4）。

**読み込み側の関数は作らない。** ファイルの JSON は LocalStorage の JSON と同じ形式・同じ危険度（未知の部品定義・存在しない端子）なので、`parseDocument()` をそのまま通す。書式の判定規則が 2 箇所に分かれると、片方だけ厳しくなって「保存はできるのに読み込めないファイル」が生まれる。落とした要素の通知（`dropped`）もそのまま使える。

| 項目 | 決めごと | 理由 |
|---|---|---|
| 書式 | `JSON.stringify(document, null, 2)` ＋ 末尾改行 | 書き出したファイルは人が開いて中身を確かめ、課題として提出し、差分を見る対象になる。LocalStorage 用の `serializeDocument()`（1 行）とは用途が違う |
| ファイル名 | `relay-lab-YYYYMMDD-HHMM.json` | 同じ回路を何度も書き出すと `(1)` `(2)` が付いてどれが新しいか分からなくなる。**日本語を含めない** —— 提出や別 OS への受け渡しで化ける経路を作らない |
| DOM 操作 | `document-file.ts` には置かず `useDocumentPersistence` 側 | このファイルを React も DOM も知らない純粋関数に保ち、Vitest で往復を検証する |

**`useDocumentPersistence` 内で DOM を触るときは `window.document` と書く。** このフックのスコープでは `document` が `CircuitDocument` を指しており、素で書くと DOM ではなく回路の方を掴む。

### simulationStore（実行時のみ）

`running` / `pressedSwitches` / 最新の `SimulationResult` を保持。保存対象に含めない。押しボタンの `onPointerDown` / `onPointerUp`、切替スイッチの `onClick` で `pressedSwitches` を更新し、変更のたびに `simulate()` を呼ぶ（モーメンタリとオルタネートの差はこのストアだけに閉じている・§4.7）。

**ストアを分けた理由:** 保存対象とシミュレーション一時状態を混在させると、保存 JSON に実行時状態が混入し、Undo 履歴もシミュレーション中の変化で汚染される。

**ストア間の依存は `simulationStore → circuitStore` の一方向だけ**（`evaluate()` が `useCircuitStore.getState().document` を読む）。回路が変わればシミュレーションを解き直すべきだが、シミュレーション結果が回路を書き換えることは無い。

**`start()` は前回の結果を捨てる。** 残すと前回の励磁状態が `previousEnergizedRelays` として引き継がれ、押していない自己保持回路が最初から励磁した状態で立ち上がる。停止 → 開始が「電源を入れ直す」操作になるよう、`stop()` も `pressedSwitches` ごとクリアする。

---

## 8. UI 設計方針

- レイアウト: 3 カラム（左 240px / 中央 flex / 右 280px）＋ 上部操作バー。中心はあくまでキャンバス
- トーン: クリーン・モダン・明るめ。余白を確保し、過剰な装飾はしない。古い CAD 風にはしない
- 端子: 半径 6px 以上を確保し、ホバーで 1.3 倍に拡大。配線ドラッグ中は接続可能な端子をハイライトし、接続不可の端子は減光する
- 端子ツールチップ: 「端子 14 / コイル + / DC24V」「端子 9 / 第1接点 COM」のように、初心者が端子の意味を理解できる文言を `TerminalDefinition.description` から表示する
- 部品の見た目: 写真の完全再現はしない。**実端子番号が視覚的に読み取れることを最優先**とし、メーカー名・型番・端子番号を明示する
- プロパティパネル: 型番・種別・コイル仕様・励磁状態・接点ごとの COM/NO/NC 導通状態をシミュレーション中はリアルタイム更新する

### 8.1 React Flow との対応付け（`adapter/reactflow.ts`・Step 3 で確定）

**真実は `CircuitDocument` 側にある。** React Flow へ渡す nodes / edges は
`circuitStore` のドキュメントから毎回組み立てた派生データで、React Flow が返す変更
（移動・削除・選択・接続）は adapter を通してドキュメントへ書き戻す。
React Flow 側に状態を持たせない（CLAUDE.md 設計原則 4）。

| React Flow | 回路モデル | 備考 |
|---|---|---|
| Node ID | `CircuitDocument.components[].id` | インスタンス ID |
| Node type | `"device"` の 1 種のみ | 型番別ノードは作らない |
| Handle ID | `TerminalDefinition.id` | **恒等写像。**加工すると Edge から端子を復元する経路が増えて壊れやすい |
| Edge ID | `CircuitConnection.id` | |
| Edge type | `"wire"` の 1 種のみ | 自前の Edge。折れる位置をずらして重なりを解く（§8.7） |
| Edge source/target + Handle | `CircuitConnection.from` / `to` | Handle ID が無い接続は `null` を返して捨てる |

**端子はすべて `type="source"` の Handle 1 個、`ConnectionMode.Loose`。**
端子に「入力 / 出力」の区別は無いので、1 端子に source / target の Handle を 2 枚重ねる
代わりに Loose モードで source → source を許可する。Edge の描画も Loose なら target 側の
探索が source handle にフォールバックするため、この構成で成立する。

**ノードには必ず `measured` を載せる（`visual` の値をそのまま渡す）。** ノードは毎回
ドキュメントから組み直す派生データなので、React Flow から見ると毎回「新しいノード」に
見える。`measured` が無いノードを渡すと React Flow は初期化前とみなして端子の実測値
（handleBounds）を破棄し、ノードを `visibility: hidden` に戻す。**この状態では配線が
画面から消え、以後つなげなくなる。** 部品の寸法は `visual` で確定しているので実測を
待つ必要がない。adapter のテストでこの値を固定している。

**弾く接続。** ①Handle ID が無い（部品本体へのドロップ）②同一端子どうしの自己接続
③既存と同じ端子ペア（配線に向きは無いので順序を無視して比較）。判定は
`canConnectTerminals()` に集約し、ドラッグ中の `isValidConnection` と確定時の
`addConnection` の両方から呼ぶ。**③の「既存」から自分自身は除く**（つなぎ替え中の
配線はドキュメントに残ったままなので・§8.8）。

**キャンバス操作。** 左ドラッグ＝範囲選択、**Shift+ドラッグ＝画面移動（パン）**、
Ctrl/Cmd+クリック＝複数選択、Delete / Backspace / **D** ＝削除、**F** ＝選択中の部品を左右反転、
**S** ＝シミュレーションの開始・停止（§8.2）、**配線の端をドラッグ＝つなぎ替え**（§8.8）。
編集（囲む・つなぐ・動かす）は修飾キー無し、画面の操作は Shift 併用、という切り分け（§8.6）。

#### 部品の左右反転（`flipped`）

電源は右辺に、ダイオードは左右に端子が固定されているため、向きを変えられないと図面の
右側に置いた部品から線が本体を横切って出ていく。反転は `CircuitComponentInstance.flipped`
（§3.3）1 つで表し、**描画側だけで解決する。**

| 反転で変わるもの | 変わらないもの |
|---|---|
| 端子の相対座標 `x` → `1 - x` | 端子の ID・ラベル・実端子番号・`role`・`description` |
| 端子の `side`（left ⇄ right、top / bottom は不変） | `CircuitConnection`（配線は端子 ID で繋がっている） |
| 図記号（SVG）の左右 | `ElectricalDefinition` とエンジンの判定結果すべて |

**`ComponentDefinition` は書き換えない。** 定義は全インスタンスで共有する不変データなので、
`adapter/reactflow.ts` の `layoutTerminals()` が反転済みの端子配列を新たに作り、
`DeviceNodeData.terminals` に載せる。`DeviceNode` は `definition.terminals` ではなく
**こちらを描く。** 反転していない部品では定義の配列をそのまま返し、無駄なコピーを作らない
（MY4N は 1 個で端子 14 個）。

**`side` を写し替えないと壊れる。** 座標だけ反転しても React Flow の Handle の向きは
元のままなので、配線が部品の内側へ回り込んで出ていく。

**反転したら `updateNodeInternals(id)` を必ず呼ぶ。** これが無いと**配線が端子から
外れたまま残る。** React Flow は端子の座標を `handleBounds` としてノードごとに
キャッシュしており、測り直すのは ①ノードの寸法が変わったとき（ResizeObserver）
②`type` / `sourcePosition` / `targetPosition` が変わったとき の 2 つだけ。左右反転は
そのどちらにも当たらない — 寸法は同じままで、端子の DOM だけが反対側へ移る。
結果、`CircuitConnection` は保たれているのに Edge だけが反転前の座標に貼り付き、
「接続が切れた」ように見える。`DeviceNode` が `flipped` の変化を見て
`useUpdateNodeInternals()` を呼ぶことで解決する。

なお `useUpdateNodeInternals()` は `requestAnimationFrame` 越しに測り直すため、
**タブが非表示の間は実行されない**（ブラウザが rAF も ResizeObserver も止めるため）。
表示に戻れば React Flow 自身の ResizeObserver も含めて測り直しが走るので実害は無いが、
自動テストでこの経路を検証するときは踏む。

**部品交換（`replaceComponentDefinition`・§7）でも同じ穴を踏む。** 端子の位置や
`visual` の寸法は定義ごとに違うので、交換後は測り直しが要る。寸法が変われば
ResizeObserver が拾うが、**寸法まで同じ交換先**（端子配置も同一）では反転と同じ穴になる。

**依存には「測り直すべき条件」そのものを 1 本のキーで渡す。** `flipped` や
`definition.id` のような *要因* を並べる形にすると、端子配置を動かす要因が増えるたびに
依存配列の長さが変わり、Fast Refresh が「配列のサイズが変わった」と警告する（開発時のみ・
ビルド済みコードの不具合ではないが、編集のたびにコンソールへ出る）。ここで見たいのは
要因ではなく結果 —— 実際に描く Handle の ID・辺・位置が変わったか —— なので、
`DeviceNode` は `data.terminals` から `id:side:x,y` を連結した `terminalSignature` を作り、
`[id, terminalSignature, updateNodeInternals]` の固定長で依存を張る。反転も部品交換も、
将来端子配置を動かす別の仕組みが入っても、この 1 本で拾える。

**図記号は SVG だけを `scaleX(-1)` する。** ダイオードの三角や電池の長線／短線は向きが
意味を持つので、端子だけ反転すると絵と端子ラベルが食い違う。一方でキャプションや
押しボタンの操作ボタンは文字なので、鏡像にすると読めなくなる。`DeviceNode` が外枠へ付ける
`data-flipped` を `bodies.module.css` 側から拾って SVG に限定して掛ける
（`data-*` は CSS Modules がハッシュしないため、モジュールをまたいで指せる）。

**反転は Undo 履歴に積む。** 端子の出る辺が変わって配線の取り回しが大きく動くので、
ラベル編集（積まない）とは違い「1 手戻したい操作」になる。

**F 単独にキーを割り当てられるのは、削除の D と同じ条件を自前で満たしているから。**
`useFlipShortcut` は `window` に直接ハンドラーを載せるため、React Flow が内部で行っている
入力欄の除外が効かない。共有の `isTextEntry()`（`components/circuit/keyboard.ts`）で
input / textarea / contenteditable を自分で除外する。Ctrl / Cmd / Alt が付いていれば
ブラウザの検索（Ctrl+F）を奪わないよう何もしない。

ホイールは `panOnScroll` によりズームではなくパン（縦）に割り当てており、
**Shift+ホイールで横パン**になる（React Flow 12 が Windows でこの分岐を持つ）。

**削除に D 単独を足せるのは、React Flow の `deleteKeyCode` が入力欄を除外しているから。**
`useKeyPress(..., { actInsideInputWithModifier: false })` が `isInputDOMNode()` を見ており、
修飾キー無しの打鍵が input / textarea / contenteditable にあるときは発火しない。
部品名の入力やパレット検索に "d" を打っても回路は消えない。**自前でキー処理を書く場合は
この除外を自分で実装すること**（`useHistoryShortcuts` / `useFlipShortcut` /
`useArrangeShortcut` の `isTextEntry` が同じ役割）。

修飾キー無しの単独キーは現在 **D（削除）/ F（左右反転）/ L（配置の整理・§8.9）/
S（シミュレーションの開始・停止・§8.2）** の 4 つ。D / F / L は編集操作で、Undo 1 回で
戻せることを条件にしている。S だけは履歴に積まない画面操作だが、押し間違えても
もう一度押せば戻り、回路そのものは変わらない。

**「未検証」バッジは実端子番号を持つ型番にだけ出す。** 汎用部品（電源 / スイッチ / ランプ）は
`verified: false` だが実端子番号そのものが無く、検証対象が存在しない（§4.4 / §4.5）。
そこへ同じバッジを出すと全部品に付いて意味を失うので、パレットとプロパティパネルでは
「実端子番号なし」と無彩色で表示し、バッジは MY4N 等に限る。判定は
`lib/component-display.ts` の `hasRealTerminalNumbers()`。

**MY シリーズを公式データシートと照合した結果（§4.4）、現在この条件を満たす定義は無く、
バッジはどこにも出ない。** バッジ表示のコードは残す —— 未検証の型番を足したときに
自動で出ることが設計原則 5 の担保そのものであり、「今は出ない」は
「もう要らない」ではない。

**`visual` は端子番号の可読性で決める。** 型番表示が図記号を押し出さない大きさが必要で、
汎用部品の「型番」は長い日本語（"押しボタン A接点（モーメンタリ）"）になる。
Step 3 で 押しボタン 160×125 / 電源 150×110 / ランプ 140×130 / MY4N 260×220 に調整した。
その後、部品・吹き出しの文字サイズをアクセシビリティ向上のため引き上げた際、
`.content` の上下 padding（18px）だけでは新しいフォントサイズに対して余白が
足りず、一部の部品で上下が詰まって見えた（`scrollHeight` が `clientHeight` を
超えて `overflow: hidden` が本文を切り詰めていた）。**フォントサイズだけでなく
`visual.height` も併せて調整すること。** 現在値: スイッチ 4 種 160×170 / 電源
150×130 / ランプ 140×160 / ダイオード 140×190 / 端子台 200×170 / MY2N
210×220 / MY4N・MY4N-D2 260×240。

### 8.2 エンジンの接続（Step 4 で確定）

**再計算のトリガーは `useSimulationSync` の 1 箇所だけ。** `simulate()` は履歴を
持たない純粋関数なので、入力（回路 / 押下状態 / 実行状態）が変わったら誰かが
呼び直す必要がある。各コンポーネントが思い思いに `evaluate()` を叩くと、同じ入力で
何度も解いたり逆に解き忘れたりするので、`CircuitWorkspace` から 1 回呼ぶ形に集約した。

- 依存に `document` 全体ではなく `components` / `connections` を並べる。
  **パンやズームで `viewport` が変わるたびに回路を解き直さないため。**
- `result` は依存に入れない。入れると 評価 → 結果更新 → 再評価 の無限ループになる

**シミュレーション状態はノードの `data` に載せて配る。**
`DeviceNodeData` に `simulation`（励磁 / 点灯 / 押下）と `terminalStates` を持たせ、
`toDeviceNodes()` が `SimulationView` から詰める。ノードは元々ドキュメントから
毎回組み直す派生データなので、実行中に組み直しても §8.1 の `measured` の約束さえ
守れば壊れない。

**`simulation` が `undefined` であることが「停止中」を表す。** 別途 `running`
フラグを持たせると、停止中なのに `energized: false` が描画側へ流れ、
「消磁した」と「そもそも動いていない」が区別できなくなる。

**押しボタンはボディ側の `<button>` で操作する。**

- モーメンタリなので `onPointerDown` で押下、`onPointerUp` で復帰。
  `pointerleave` / `pointercancel` でも必ず復帰させる。ボタン外でマウスを離したまま
  押下状態が残ると、自己保持の検証で「離したのに保持が効いている」と誤読する
- React Flow の `nodrag` クラスを付け、`stopPropagation()` も併用してノードドラッグと
  競合させない
- キーボードは `keydown` / `keyup` で扱う。`button` 既定の `click` では
  「押しっぱなし」を表現できない

#### 開始・停止のショートカットは S 単独

`useSimulationShortcut` が `window` に 1 本だけリスナーを張り、いまの `running` を見て
`start()` / `stop()` を切り替える。修飾キー無しの単独キーで、`isTextEntry()` による
入力欄の除外と Ctrl / Cmd / Alt での離脱は D / F / L と同じ（§8.1）。押しっぱなしの
キーリピートは `event.repeat` で捨てる。**リピートでトグルが走ると、開始のたびに
`pressedSwitches` と前回の励磁状態が捨てられる**（§7）。

キーそのものは `lib/shortcuts.ts` の `SIMULATION_KEYS` から取り、**ヘルプの
「シミュレーション」の行も同じ定数から作る**（§8.10）。ここに `"s"` を直書きすると
ヘルプに載らないショートカットができる —— **載っていないショートカットは、
無いのと同じか、偶然見つけたときに不具合に見える。**

**Space は割り当てない。** 上の押しボタンが Space / Enter で押下・復帰を表現しており、
シミュレーション中はクリックしたスイッチにフォーカスが残る。Space を停止に充てると
「スイッチを押す」のか「停止する」のかが打鍵時のフォーカス位置で変わる。開始・停止
ボタン自身にもフォーカスが残るため、ネイティブの `click` とグローバルハンドラーが
二重に発火する。React Flow の Space パン（`panActivationKeyCode` 既定）は Shift へ
移してあり空いている（§8.6）が、この 2 つは残る。

**配線色は CSS Modules のクラスで当てる。** `WireState` → クラス の対応表を
`CircuitCanvas` が持ち、React Flow の Edge の `className` として渡す。
セレクタは `.canvas .wireXxx :global(.react-flow__edge-path)` の 3 クラスで、
既定色（2 クラス）より強く、選択中（`.react-flow__edge.selected` を含む 4 クラス）
より弱い。**実行中でも選択した配線はアクセント色で判別できる**必要があるため、
この強さの順序は崩さないこと。

**警告は Step 4 では一覧表示しない。** 操作バーに出すのは収束結果
（`実行中` / `発振中（ブザー動作）` / `収束しません`）だけで、`Warning[]` の
提示は Step 6。発振はエラーではないので、赤ではなく警告色で出す（§5.5）。

### 8.3 プロパティパネルと端子ツールチップ（Step 5 で確定）

**パネルは判定を持たない。** 表示に必要な読み取りは
`adapter/inspection.ts` の `inspectComponent()` に閉じ、
`PropertiesPanel` は返ってきた `ComponentInspection` を並べるだけにした。
React を import しない純粋関数なので、「押しボタンを押すと接点が COM–NO へ倒れる」
ところまでブラウザを起動せずに Vitest で検証できる（`inspection.test.ts`）。

```ts
inspectComponent(document, definitions, result, pressedSwitches, componentId)
  → { instance, definition, device?, contacts[], terminals[], conducting? } | null
```

引数は `buildSimulationView()` と同じ並びに `componentId` を足しただけで、
ビューは内部で組み直す。パネルは 1 部品しか見ないが、端子の電位は
「通電中の負荷に隣接するか」を回路全体から決める（§5.6）ので部分計算では求まらない。
末尾の `selfHold`（§5.9）だけは**受け取るだけで組み直さない** —— 検出に `simulate()` の
再実行が要るので、パネル側の `useMemo`（選択部品に依存させない）に任せる。

**`device` が `undefined` であることが「停止中」を表す。** §8.2 のノードと同じ約束。
パネルでは停止中を「オフ」ではなく `—（停止中）` と出す。
非励磁と「そもそも動いていない」を同じ灰色で描くと、実行し忘れに気付けない。

**接点の開閉はエンジンに引き直す。** 「非励磁なら COM–NC、励磁なら COM–NO」の規則は
`engine/relay.ts` の `closedContactPairs()` に 1 箇所だけ置いてある。adapter 側で
`energized ? "no" : "nc"` と書き直すと同じ規則が 2 箇所になるので、エンジンの答えの
COM の相手が NO かどうかで判定する。

**スイッチの導通は「同じネットに居るか」で読む。** 開閉の規則（A 接点は押下中だけ閉じる）
は `engine/graph.ts` の持ち物なので再実装しない。表示したいのは規則ではなく結果であり、
外部配線で短絡していれば「導通している」と出るのがむしろ正しい。

**カテゴリごとの表示は `ElectricalDefinition.kind` の 6 通りだけで分岐する。**
型番では分岐しない（CLAUDE.md 設計原則 2）。新型番を足してもパネルは変わらない。

**ダイオードだけは停止中も「役割」を出す。** 他の実行時状態（励磁・点灯・導通）は
`device === undefined` を「停止中」として `—` にするが、**「どのコイルと並列で、向きは
正しいか」は配線そのものの性質**であって実行中にしか決まらない値ではない（§5.4）。
逆挿しは動かす前に気付けるべきなので、停止中は `inspection.ts` 側で静止状態のネットを
1 回だけ組み直して判定する。バイアスの向き（順方向 / 逆方向）は実行中の値なので従来どおり `—`。

**部品交換（Step 9 で確定）。** 名前欄のすぐ下に「部品交換」のセレクトを置く。選択肢は `componentDefinitions` を現在の部品と**同じカテゴリ**（`category`）かつ自分自身を除いたものに絞り込む。候補が無いカテゴリ（電源・ランプ・端子台・ダイオードは現状 1 種類ずつ）ではセレクト自体を出さない。選ぶと即座に `replaceComponentDefinition()` を呼んで交換し、セレクトは常に空文字（プレースホルダー「交換先を選択…」）へ戻す — 交換後は候補一覧そのものが変わる（今の部品が新しい候補に加わり、選んだ部品が外れる）ため、選んだ値を保持し続ける意味が無い。

**ラベル編集は Undo 履歴に積まない。** `setComponentLabel()` は 1 文字ごとに発火する。
§7 のスナップショット地点（部品追加 / 削除 / 配線確定 / ドラッグ完了）に加えないので、
Step 6 の Undo でラベル変更は戻らない。ドラッグと同じ理由で、1 回の入力で履歴が
数十件積まれるほうが害が大きい。前後の空白落としは `onBlur` で行う —
`onChange` で `trim()` すると「RY 1」の途中（`"RY "`）で空白が消えて打てなくなる。

**端子ツールチップは CSS の `:hover` だけで出す。** 本文は
`TerminalDefinition.description`（「端子 14 / コイル + / DC24V」）をそのまま出し、
持たない端子は「端子 &lt;ラベル&gt;」にフォールバックする。
MY4N 1 個で端子が 14 個並ぶので、端子ごとに React の状態を持たせて
再レンダリングを増やしたくない。`.terminal` は大きさ 0 のアンカーだが、
Handle は子要素なので Handle にホバーすれば `.terminal:hover` が立つ。

ネイティブの `title` は**使わない。** 独自ツールチップと二重に出るうえ、
表示まで 1 秒近く待たされて「端子の意味をすぐ読める」体験にならない。
読み上げ用には Handle の `aria-label` に同じ本文を載せる。

**端子ツールチップに「接続先」を出す（Step 8 の追加）。** 本文の下に、
その端子につながる配線の相手側を「RY1 の端子 14」のように 1 本ずつ並べる。
配線が無い端子は「未接続」と出す。

- **見せるのは配線（`CircuitConnection`）そのもの。** ネットまで辿って
  スイッチ・端子台の導通で間接的につながる先まで拾うと、ホバーした端子と
  無関係な部品まで列挙されて「この線がどこへ行くか」がかえって読めなくなる。
- **1 端子に複数の配線が集まっていれば配列で全部出す。** 端子台の分岐や、
  同じ電源端子から複数本引き出すケースがあるため。
- 組み立ては `adapter/terminal-connections.ts` の `buildTerminalConnections()`
  1 か所に閉じる。ドキュメント全体を 1 回走査して
  `terminalRefKey()` → 接続先一覧 の表を作り、`toDeviceNode()` が
  `DeviceNodeData.terminalConnections` として 1 部品ぶんに絞って渡す
  （`terminalStatesOf()` と同じ「全体表を組んで、ノード側で絞る」形）。
  React を import しない純粋関数なので Vitest で検証できる。
- 相手部品の呼び名は `engine/validation.ts` の `describeComponent()`
  （ラベルがあればラベル、無ければ型番）を使い回す。警告文の言い回し
  （「RY1 の端子 14 は未接続です」）と揃えるため、ここだけ別の文言にしない。

### 8.4 保存・Undo・診断の UI（Step 6 で確定）

**`ReactFlowProvider` を張る層とフックを使う層を分ける。** 保存の復元は
`setViewport()` を呼ぶ必要があり（後述）、プロバイダーを張ったコンポーネント自身は
`useReactFlow()` を呼べない。`CircuitWorkspace` はプロバイダーだけを張り、
中身を `Workspace` に落として `useSimulationSync` / `useDocumentPersistence` /
`useHistoryShortcuts` をそこで呼ぶ。

**保存の駆動も 1 箇所（`useDocumentPersistence`）。** §8.2 の再計算と同じ理由で、
各コンポーネントが思い思いに書き込むと同じ回路を何度も直列化する。

- **書き込みは 500ms 間引く。** 引き金は `document` の変化なので、パンやドラッグ中は
  毎フレーム来る。操作が止まってからまとめて 1 回書く
- **初回読み込みが済むまで書き込まない。** 空の回路で既存の保存を潰さないため
- **読み込み後に `setViewport()` を呼ぶ。** `defaultViewport` は初回マウントでしか
  効かず、読み込みはその後に起きる。呼ばないと保存した表示位置に戻らない
- **保存できない環境を必ず知らせる。** 自動保存は目に見えないので、
  プライベートモードや容量超過を黙っていると、リロードで消えて初めて気付く。
  操作バーに `保存済み` / `保存中…` / `保存できません` を出す

**読み込みで落とした要素は操作バー直下に一度だけ通知する**（§7 の `dropped`）。
閉じられるようにし、3 件までを出して残りは「他 N 件」に畳む。

#### ファイルの書き出し・読み込みボタン

操作バーに `⬇ 書き出し` / `⬆ 読み込み` を置く（実装は §7 の `document-file.ts`）。

- **`<input type="file">` は `display: none` で隠し、ボタンから `click()` する。**
  `opacity: 0` で重ねる手もあるが、見えない入力欄が Tab 順に残ると、
  キーボード操作で「押しても何も起きない場所」を通ることになる
- **`change` のたびに `event.target.value = ""` へ戻す。** 同じファイルを選び直すと
  値が変わらず `change` が発火しない。書き出し → 直して → 同じ名前で読み直す、が効かなくなる
- **読み込み前に確認を取る。** 読み込みは `replaceDocument()` を通り、履歴ごと
  差し替わる（§7）ので **Undo で戻せない。** 回路が空でないときだけ
  `window.confirm` で部品数とファイル名を示して確認する
- **成功も通知する。** 落とした要素が無いと通知が一切出ず、「押したのに何も
  起きていない」のか「読み込めた」のか区別が付かない
- **書き出しは空の回路では押せない。** 中身のないファイルを作っても使い道がない

**Undo / Redo のキー操作は入力欄で無効にする。** プロパティパネルの名前欄で
`Ctrl+Z` を押したときに文字ではなく回路が巻き戻ると、何が起きたのか分からない。
`Ctrl/⌘ + Z` で戻し、`Ctrl/⌘ + Shift + Z` と `Ctrl + Y` でやり直す。

**診断（`WarningList`）は種別＋深刻度で束ねる。** MY4N を 1 個置いただけで
未接続端子が 14 件出るので、素直に縦へ並べると最も危険な電源短絡が画面外へ
押し出される。束ねの軸に深刻度も入れているのは、同じ `coil-polarity-reversed` でも
`strict`（error）と `indicator`（warning）で意味がまるで違うから（§5.7）。
1 グループ 4 件までを出し、残りは「他 N 件を表示」で開く。

**発振を赤で出さない。** B 接点による自励発振は配線として正しくても必ず起きる
挙動なので、ブザー回路を組んだ人に「エラー」を出してはいけない（§5.5）。
深刻度バッジに色を付けるのは `error`（短絡の赤）と `warning`（黄）だけ。

**停止中は「配線チェック」に切り替える**（`useWiringCheck` → `inspectWiring`・§5.7）。
当初は「未実行」とだけ出していたが、それでは電源を入れる前から分かっている
誤配線（未接続の端子・静止状態の短絡・ダイオードの逆挿し）を ▶ まで黙っていることになり、
「実機を配線する前に確認する」という目的に対して一手遅い。

- 見出しそのものを **`診断`（実行中）/ `配線チェック`（停止中）** で入れ替える。
  同じ枠に別の範囲の結果を出すので、どちらを見ているかが分からないほうが危ない
- 停止中は見出しの下に**見ている範囲を必ず添える** —— 「電源を入れずに分かる範囲を
  見ています。押しボタンを押して初めて起きることは ▶ で確認してください」。
  **この画面でいちばん困る誤解は、停止中の「指摘はありません」を「この回路は正しい」と
  読まれること**（§5.7 の「指摘が無いことは配線が正しいことを意味しない」）
- 停止中の空表示も「指摘なし」ではなく「配線**そのもの**への指摘はありません」と書く
- **部品が 1 個も無いときは何も主張しない** —— 「部品を置くと配線チェックを表示します」。
  空のキャンバスに「指摘はありません」と出すのは無意味な合格判定になる
- 実行中は配線チェックを呼ばない。▶ の診断のほうが厳密に多くを見ており、
  両方並べると同じ未接続端子が二重に出る

**警告からは該当部品を選べる。** `componentId` を持つ警告はボタンにして
`selectOnlyComponent()` を呼び、プロパティパネルに送る。部品を特定できない
警告（発振・収束せず）は押せない行のまま出す。

### 8.5 パレットの部品検索（`lib/component-search.ts`・Step 7 で確定）

**絞り込みの規則は `searchComponentDefinitions()` に閉じる。** パレット側に
`filter` を書くと、UI を起動しないと検索を検証できなくなる。React を import
しない純粋関数なので Vitest で確かめられる（`component-search.test.ts`）。

- **検索対象は型番・メーカー・カテゴリ（＋定義 ID）だけ。** 端子番号まで拾うと
  "14" が MY2N・MY4N・MY4N-D2 のすべてに当たり、「型番を探す」目的から外れる
- カテゴリは日本語表示（"リレー" "端子台"）でも引ける。`CATEGORY_LABELS` を
  そのまま検索対象に混ぜているので、パレットの見出しに見えている語が必ず当たる
- **NFKC で正規化する。** 日本語 IME で全角のまま確定した "ＭＹ４Ｎ" が当たらないと、
  検索窓が壊れているように見える
- 空白区切りは AND（"omron d2"）。空クエリは絞り込まない — 空欄は全件表示そのもの

**0 件を空白で返さない。** 該当が無いときは「「〜」に一致する部品はありません。」と
出す。カテゴリ見出しごと消えるので、無言だとパレットが壊れたように見える。

`lib/` に置いたのは、カテゴリの日本語表示（`component-display.ts`）を参照するため。
`definitions/` から表示層を import すると依存が逆流する。

### 8.6 範囲選択（`adapter/selection.ts` + `useRangeSelection`・Step 8 で確定）

枠で囲んでまとめて消す操作。**判定は React Flow に任せず、こちらが持つ。**

#### なぜ React Flow の範囲選択をそのまま使えないか

1. **配線そのものを枠で選べない。** React Flow の範囲選択（`container/Pane` の
   `commitUserSelectionRect`）は「枠に入ったノード」と「そのノードに繋がる Edge」しか
   選ばない。**電源とリレーを結ぶ長い 1 本を、途中で小さく囲んで消す**という図面の
   直しが成立しない。両端の部品は残したいのだから、部品ごと囲むわけにもいかない。
2. **対象の絞り込み（部品のみ / 配線のみ）を後から間引けない。** React Flow は選択変更を
   流すときに内部の `nodeLookup` / `edgeLookup` の `selected` を**同時に書き換える**
   （`getSelectionChanges(..., mutateItem: true)`）。変更ハンドラー側で握り潰すと
   「React Flow は選択済みだと思っているのに画面は非選択」という食い違いが残り、
   同じ値への変化は差分なしと見なされるため **その部品は以後クリックしても選べなくなる。**

そこで **枠が出ている間（`userSelectionRect` が非 null）は選択集合をこちらが毎フレーム
宣言し直す。** `CircuitCanvas` の `onNodesChange` / `onEdgesChange` はその間の select 変更を
無視し、`useRangeSelection` が計算した結果でストアを丸ごと差し替える。ストアが変われば
nodes / edges が組み直され、React Flow 側の `selected` も追随するので食い違いが毎フレーム解消する。

**枠が無い間は一切関与しない。** 単体クリックと Ctrl/⌘+クリックは React Flow の経路のまま。
プロパティパネルを見るために部品をクリックする操作を、範囲選択の設定で縛らない。

#### 当たり判定（`circuit/adapter/selection.ts`・純粋関数）

| 対象 | 規則 | 理由 |
|---|---|---|
| 部品 | 枠に **すっぽり収まった**もの（React Flow の `SelectionMode.Full` と同じ） | かすっただけで選ぶと、囲んだつもりの無い MY4N が一緒に消える |
| 配線 | 両端子を結ぶ線分が枠に **触れた**もの | 配線は面積を持たない。「完全に入れる」にすると部品間を渡る線がほぼ選べない |

非対称だが、どちらも「枠の内側に見えているものが選ばれる」という同じ直感に落ちる。

- 端子の座標は `TerminalDefinition.position`（相対）× `visual` の寸法 + 部品位置。
  **左右反転（`layoutTerminals`）を必ず通す** — 通さないと判定線が実際の配線と左右逆になる
- 定義が引けない部品／端子に繋がる配線は判定から落とす（描画側も同じ理由で落としている）
- 面積ゼロの枠（クリック、真横へのドラッグ）では何も選ばない
- React Flow の選択枠はコンテナ基準のスクリーン座標。`transform`（`[x, y, zoom]`）で
  キャンバス座標へ直してから渡す。座標変換は UI 層（`useRangeSelection`）の責務で、
  `selection.ts` 側は `@xyflow/react` を import しない

#### 対象の切り替え（`RangeSelectionTarget`）

| 値 | 部品 | 配線 |
|---|---|---|
| `both`（既定） | 枠に収まったもの | 枠に触れたもの ＋ 選ばれた部品に繋がるもの |
| `components` | 枠に収まったもの | 選ばない |
| `connections` | 選ばない | 枠に触れたもの |

「部品と配線をまとめて消す」と「配線だけを引き直す」は別の作業で、後者では枠に入った部品まで
選ばれると邪魔になる（逆も同じ）。`both` で部品側の配線も足すのは、囲んだ範囲がそのまま
消せないと「まとめて消す」にならないため。なお **`components` で消しても、その部品の端子に
繋がる配線は道連れになる**（`removeFromDocument`）— 選択に入るかと、削除で残るかは別の話。

#### ドラッグの割り当て（パンは Shift 併用）

| 操作 | 割り当て |
|---|---|
| 左ドラッグ（何もない所） | 範囲選択（`selectionOnDrag`） |
| **Shift + 左ドラッグ** | **画面移動（パン）** |
| 中ボタン／右ドラッグ | 画面移動（`panOnDrag={[1, 2]}`） |
| ホイール | 画面移動（`panOnScroll`・Shift+ホイールで横） |

**編集は修飾キー無し、画面の操作は Shift 併用に揃える。** 図面を直している間の
ドラッグは大半が「囲む・つなぐ・動かす」で、パンはその合間に挟むものだから。

React Flow では `panActivationKeyCode`（押している間だけ `panOnDrag` を true にする
キー・既定 Space）に `Shift` を割り当てて実現する。**このとき `selectionKeyCode` を
`null` にすること。** 既定では Shift が範囲選択キーで、両方に Shift が乗ると
`panOnDrag: !selectionKeyPressed && panOnDrag` でパンが打ち消され、Shift を押しても
画面が動かない。

左ドラッグを常に範囲選択にする構成は、以前は「端子を掴み損ねるたびに枠が出てパンできなく
なる」ため採っていなかったが、パンを Shift へ移したことでその穴は塞がっている。
モードの切り替えが要らなくなったので操作バーのトグルは置かない。

#### 操作モードの置き場所

範囲選択の対象は**画面の操作モードで、保存対象でも履歴の対象でもない。**
`circuitStore` に混ぜず `CircuitWorkspace` の state として Toolbar と CircuitCanvas が
共有する。

### 8.7 配線の重なり解消（`adapter/wire-lane.ts` + `edges/WireEdge.tsx`）

`smoothstep` の経路は「端子から真っ直ぐ出る → 中間で 1 回折れる → 端子へ入る」の形で、
**折れる位置（以下 *幹線*）は既定で両端の中点に固定されている。** そのため同じあたりを走る
配線は幹線がぴったり重なり、2 本が 1 本に見える。電源のレールから複数のリレーへ渡る線は
ラダー図でいちばん多く出る形なので、実用上かなり困る。

**「絶対に重ならない」は採らない。** 部品も他の配線も避ける直交ルーティングは、経路が
図面の状態で動的に変わるぶん読み手の予測を裏切りやすく、実装量も別物になる。ここでは
①重なる幹線をずらして解ける範囲は解く ②解ききれない箇所は 1 本ずつ辿れるようにする、
の 2 段構えを採る。

#### レーン分離（`buildWireLanes`）

1. 配線ごとに**幹線の向き・座標・伸びている範囲**を求める
2. 幹線が近い（12px 以内）ものを 1 つの束にまとめる
3. 束の中で**区間が重なる配線どうしにだけ別のレーン番号を配る**（区間グラフの貪欲彩色）
4. レーン番号を中央から交互（0, +10, −10, +20 …）の符号付き px へ写す

**重なっていない配線は動かさない。** 束の中でも y（横の幹線なら x）の範囲が交わらなければ
同じレーンのままにする。無闇にずらすと、混んでもいない場所の線まで部品からずれて浮く。

**幹線の向きは端子の *辺* だけで決まる。** `getSmoothStepPath` の `getDirection` は
`sourcePosition` しか見ておらず、両端の距離は関係しない。「横に長ければ縦の幹線」のような
当て推量にすると、実際の描画と違う幹線をずらして重なりが解けない。左右反転した部品では
辺も鏡像になるので、`layoutTerminals()` を必ず通す（§8.1）。

**向かい合っていない辺どうし（右 → 右など）は対象外。** この場合 `getSmoothStepPath` は
中点を使わないので、ずらす手段が無い。`trunkOf` が `null` を返して束から外れる。

**部品が近すぎるときはずらさない。** 幹線は両端の「端子から真っ直ぐ出た点」の間に立って
いなければならず、そこを越えると経路が折り返して重なり以上に読みにくくなる。ずらし量は
`room = |両端の距離| / 2 − 角丸の余白` で頭打ちにする。**この場合レーンが分かれても重なりは
残る** —— そこは下の強調で拾う。

**実行中も停止中も計算する。** 線が重なって読めない問題は動かしているかどうかと無関係
（§5.8 の役割配色が停止中限定なのとは事情が違う）。計算量は端子数に線形で、同じ `useMemo`
群にいる `toDeviceNodes` より軽い。

#### 描画（`components/edges/WireEdge.tsx`）

幹線を動かせるのは `getSmoothStepPath` の `centerX` / `centerY` だけで、React Flow 標準の
`SmoothStepEdge` はこれを外へ出していない（`pathOptions` は `offset` と `borderRadius` のみで、
どちらも折れる位置を動かさない）。そのため Edge 種別を `"smoothstep"` から自前の `"wire"` へ
差し替える。**経路の計算そのものは `getSmoothStepPath` に任せる**ので、折れ方の規則は
React Flow のままで、ここが足すのはずらし量だけ。

**ずらさない配線には `centerX` / `centerY` に `undefined` を渡す。** 関数側が
`center.x ?? 既定値` で受けるので、レーン 0 の配線は従来と 1 バイト違わない経路になる。
中点を自前で計算して渡すと、上下端子や回り込む配線で React Flow の既定値（端子から
離れた点どうしの中点）と食い違う。

ずらし量は電気的な意味を持たない**表示だけの値**なので、`CircuitConnection` には入れず
`WireEdgeData.lane` として毎回組み立てる（ノードの `terminals` と同じ扱い・§8.1）。

#### 交差した束から 1 本を拾う

レーン分離で解けない重なりは残る —— ずらす余地が無い箇所と、そもそも直交する 2 本が
交わっている箇所。**ホバー中と選択中の 1 本だけ**、背景色の帯（halo）を線の下に敷いて
周りを抜き、経路を端から端まで追えるようにする。

Edge は 1 本ずつ別の `<svg>` に描かれるので、帯が効くのはその配線が最前面にいるときだけ。
ホバーは `onEdgeMouseEnter` / `Leave` で拾った ID に `zIndex` を与え、選択は React Flow の
`elevateEdgesOnSelect`（+1000）に任せる。ホバーはそれより上（2000）に置く。

**ホバーで色は変えない。** 色は電位（§5.6）や役割（§5.8）の意味を持っているので、
上書きすると「今どの色の線に触れているのか」が分からなくなる。太さだけを 1 段上げる。
CSS の詳細度が選択中の指定と同じなので、**ホバーの規則は選択中より後ろに置くこと**
（先に書くと選択中の配線をホバーしても太くならない）。

ホバー中の ID は回路の一部ではないので `circuitStore`（保存対象＋履歴）には入れず、
`CircuitCanvas` の state で持つ。

### 8.8 配線のつなぎ替え（`circuitStore.reconnectConnection` + `WireEdge`）

一度繋いだ配線は、**端を掴んで別の端子へ引き直せる。** これが無いと「端子 13 に繋ぐ
つもりが 14 だった」を直すのに、消してから同じ経路をもう一度引くことになる。図面の
直しで最も多い操作なので、削除以外の手段を用意する。

#### 消して張り直すのではなく、端子参照だけを差し替える

`reconnectConnection(connectionId, params)` は **配線 ID を変えない。** 同じ 1 本を
引き回しただけなので、`CircuitConnection.from` / `to` を書き換えて配列の同じ位置に戻す。
ID を変えると次の 3 つが同時に起きる。

- 選択が外れる（`selectedConnectionIds` は ID を指している）
- レーン（§8.7）が振り直され、掴んでいない他の配線まで折れ位置が動く
- Undo が「削除」「追加」の 2 手になる

**履歴は 1 手。** 空振り —— 存在しない配線 ID・掴んで同じ端子へ戻した・引き直した先に
既に同じ端子ペアの配線がある —— は履歴を汚さず、配線を元のまま残す。

#### 重複判定から「自分自身」を外す

引き直している最中の配線は**ドキュメントに残ったまま**なので、`hasTerminalPair()` を
素直に当てると自分自身と重複して不許可になる。既存の配線と ID が一致するものは
重複とみなさない、という規則を `hasTerminalPair()` 側に入れ、`canConnectTerminals()` は
つなぎ替え中の配線 ID を受け取ってそれを候補の ID に使う（新規配線のときは既存と
決してぶつからない仮 ID）。**判定の入口は §8.1 と同じ 1 か所のまま**にするための構造。

#### 掴み手（reconnect anchor）

当たり判定は React Flow の `EdgeUpdateAnchors` が持つ透明な円で、**端子から外向きに
`reconnectRadius` px ずらした点**が中心になる。既定の 10 では狭い —— 端子の Handle が
半径 12px の当たり判定を持ち、ノードは Edge より手前に描かれるので、端子寄りの部分は
端子に取られて「掴み手を狙ったのに新しい配線が伸び始める」。**14 にして**端子の外に
12〜28px の帯を残す。折れ線が端子から真っ直ぐ出る距離（`getSmoothStepPath` の既定
オフセット 20px）より内側なので、この点は必ず線の上に乗る。

透明なままでは**引き直せること自体に気付けない**ので、`WireEdge` が同じ位置に見える点
（半径 4px・アクセント色）を描き、**ホバー / 選択中だけ**出す（halo と同じ出し入れ）。
常時表示にはしない —— 配線が数十本ある図面では端子のそばに点が散らばり、本プロダクトが
最優先で読ませたい端子番号が読み取りにくくなる。点は `pointer-events: none`。掴む
当たり判定は React Flow の円が持っており、こちらが奪うと掴めなくなる。

#### 空きスペースへ落としたら元に戻す

接続先の無い場所で離しても**配線は消さない**（`onReconnectEnd` は掴んでいる ID を
捨てるだけ）。掴み損ねただけで配線が消えると、直そうとして壊すことになる。削除は
Delete / Backspace / D という別の操作に残す（§8.1）。

つなぎ替え中の配線 ID は `CircuitCanvas` の **ref** で持つ。これを読むのはドラッグ中に
毎フレーム呼ばれる `isValidConnection` で、state にすると掴んだ瞬間にハンドラーが
作り直される。表示にも使わないので再描画する理由が無い。

### 8.9 配置の自動整理（`adapter/auto-layout.ts` + `auto-arrange.ts`）

部品はマウスで置くので、揃えたつもりでも数 px ずつずれる。配線の折れ方（§8.7）は
端子座標で決まるため、ずれは経路の乱れとしてそのまま図面に出る。ボタン 1 つで整える。

#### 並べ直すのではなく、描いた並びを整える

**回路構造からの自動レイアウトは採らない。**「電源を左・接点を中・負荷を右へ」と
接続関係から配置し直す方式は、図面としては整うが、**どこに何を置くかという書いた本人の
意図を毎回捨てる。** 制御盤の図面では「この一帯が非常停止まわり」のような並びに意味が
あり、それを作り替える機能は整理ではない。やるのは次の 3 つだけ。

| 手順 | 内容 | 定数 |
|---|---|---|
| 1. グリッド吸着 | 部品の左上をキャンバスのドットへ乗せる | `LAYOUT_GRID = 16` |
| 2. 行・列の整列 | ほぼ揃っている部品どうしを同じ座標へ寄せる | `ALIGN_TOLERANCE = 32` |
| 3. 重なりの解消 | 重なった部品だけを下へ逃がす | `LAYOUT_GAP = 32` |

`LAYOUT_GRID` は `CircuitCanvas` の `<Background variant={Dots} gap={16} />` と同じ値。
整列した部品の左上が画面のドットに乗るので、揃ったことが目で分かる。

#### 整列のクラスタリング（先頭基準・平均へ寄せる）

x と y を**独立に**クラスタリングする。片方だけ揃えた配置（縦に並んだ列・横に並んだ行）が
そのまま活きる。

- **クラスタの基準は先頭の値で、1 つ前の値ではない。** 直前の値から数えると、32px ずつ
  ずれた部品が数珠つなぎに 1 クラスタとなり、図面の端から端までが 1 列へ潰れる。
  先頭基準なら 1 クラスタの幅は必ず `ALIGN_TOLERANCE` 以内に収まる
- 代表値は**クラスタの平均をグリッドへ吸着**したもの。先頭の値を代表にすると、
  クラスタ全体が一番外側の 1 個に引っ張られて、押すたびに図面がじわじわ動く

#### 重なりの解消は下向きに固定

上から順（y → x → id）に置き、既に置いたものと重なったら `blocker.bottom + LAYOUT_GAP` へ
逃がす。**逃がす向きを下に固定している**のは、ラダー図が上から下へ読むものだから。
横へ逃がすと揃えたばかりの列が崩れる。逃がすたびに y は障害物 1 個ぶん必ず下がるので、
障害物の数だけ繰り返せば必ず空きに着く。辺が接しているだけ（座標が等しい）は重なりとしない。

定義が引けない部品は**対象からも障害物からも外す。** 寸法が分からず、そもそも描画も
されていない（`toDeviceNodes`）ので、重なりを判定しようがない。

#### 対象は「選択中があればそれだけ、無ければ全体」

「選択を削除」と同じ考え方。一帯だけ直したいときは囲んでから押す。
**選択外の部品は動かさないまま障害物として扱う** —— 選択した一帯を整えた結果、
周りの部品に重なっては困る。

#### 履歴は 1 手（`circuitStore.applyLayout`）

部品が 20 個動いても Undo 1 回で戻る。ドラッグ中の `moveComponent` は履歴を持たず
`beginComponentDrag` / `endComponentDrag` の対が受け持つ（§7）が、自動整理は 1 回の
ボタン操作なので、まとめて 1 手であること自体が要件になる。

`arrangeComponents` は**動かす必要のある部品だけ**を返し、既に整っていれば空の Map を
返す。呼び出し側はこれで「押しても何も起きない」を判別でき、空振りの 1 手が積まれない。

#### 呼び出し口を 1 本にする（`auto-arrange.ts`）

操作バーのボタンと L キーが同じ `runAutoArrange()` を通る。**フックにしていない**のは、
両方から使うと `window` のリスナーが二重に張られるため。`useFlipShortcut` と同じく
ストアは購読せず `getState()` でその場で読む。

判定は `adapter/auto-layout.ts` の純粋関数（React も `@xyflow/react` も import しない）が
持ち、`auto-arrange.ts` はレジストリと選択を与えて結果をストアへ渡すだけ。ストアは寸法も
レジストリも知らない。§8.6 の範囲選択（`selection.ts` ← `useRangeSelection`）と同じ形。

#### ショートカットは L 単独

削除の D・反転の F と同じく修飾キーを付けない（§8.1）。整理は「部品を足す → 少しずれる →
整える」を配置の合間に何度も挟む操作で、操作バーまでポインタを往復させると配線の作業が
止まる。**Ctrl+L はブラウザのアドレスバーに取られ `preventDefault()` も効かない**ため、
修飾キー付きの組み合わせは選べない。押し間違えても Undo 1 回で戻る。

操作バーのラベルは選択の有無で「配置を整列」/「選択を整列」と言い換える。「整列」とだけ
書くと、囲んで押したときに図面全部が動くように読める。

### 8.10 操作ヘルプ（`HelpDialog` + `lib/shortcuts.ts`・Step 10 で確定）

**知らなければ辿り着けない操作が増えすぎた。** D で削除・F で反転・L で整列・
**画面移動は Shift+ドラッグ** —— どれも画面のどこにも書かれておらず、
初見のユーザーが最初にぶつかるのは「キャンバスが動かせない」（素の左ドラッグを
範囲選択に取った副作用・§8.6）。操作バーの `?` から 1 枚のダイアログで出す。

#### キー割り当ての出典を 1 箇所にする

`DELETE_KEYS` / `FLIP_KEYS` / `ARRANGE_KEYS` / `SIMULATION_KEYS` /
`PAN_ACTIVATION_KEY` / `PAN_BUTTONS` / `MULTI_SELECT_KEYS` は `lib/shortcuts.ts` に
集約し、**React Flow へ渡す値も `useFlipShortcut` / `useArrangeShortcut` /
`useSimulationShortcut` の判定も、ヘルプの表も同じ定数から作る。**

割り当てを `CircuitCanvas` に置いたままヘルプへ書き写すと、キーを変えた瞬間に
ヘルプが嘘になる。**間違ったヘルプは無いヘルプより悪い** —— 「D で消えるはず」と
信じて押した打鍵が別の動作をする。`shortcuts.test.ts` が、表の各行が定数と
一致していることを押さえる（`displayKeys()` は CapsLock 対策の `["d", "D"]` を
表示上 1 つの `D` に畳む）。

**単独キーどうしの衝突も同じテストで落とす。** D / F / L / S はそれぞれ別の
リスナーを `window` に張っており、**同じキーを 2 つに割り当てても静かに両方走る**
（先に登録された方が勝つ、という仕組みが無い）。定数を 1 箇所に集めた効果は
「重複しているかどうかを 1 回の走査で言えること」にあるので、そこまでやる。

#### ヘルプを開いている間はキャンバスのショートカットを黙らせる

D / F / L は**修飾キー無しの 1 打鍵で回路を変える**（削除・反転・整列）。
それらのリスナーは `window` と React Flow 側にあり、`<dialog>` がフォーカスを
閉じ込めていても**イベントの伝播そのものは止まらない。** 止めなければ、
ヘルプを読みながら押した文字で背後の回路が消える。S（開始・停止）は回路を
変えないが、ヘルプを読んでいる間に勝手に通電が始まるのは同じく困るので
まとめて黙らせる。

`<dialog>` の `onKeyDown` / `onKeyUp` で `stopPropagation()` する。React の
ハンドラーはルートコンテナで処理されるので `window` / `document` のリスナーより
先に走る。Esc で閉じるのはブラウザ側の `cancel` イベントなので、これを止めても効く。

`open` 属性ではなく **`showModal()` で開く。** モーダルとして開いた `<dialog>` だけが
フォーカスを閉じ込め、`::backdrop` で背後を覆う。属性で開くと、ヘルプを読みながら
背後の部品を操作できてしまう。

#### 中身は 3 つ

| 節 | 出典 | 意図 |
|---|---|---|
| まずこの 3 手 | `help-content.ts` の `BASIC_STEPS` | 置く → 繋ぐ → ▶。最初の 1 回で詰まらせない |
| 操作一覧 | `shortcuts.ts` の `SHORTCUT_GROUPS` | キーとマウス操作を同じ表に載せる。**初見でいちばん困るのはキーボードショートカットの表には現れない**（画面移動） |
| このシミュレーターが扱わないこと | `help-content.ts` の `LIMITATIONS`（＝§6） | 仕様上そうなる挙動を黙っているとバグに見える |

区切りの「/」は**手前のキーにくっつける。** 後ろに付けると、折り返した行が「/」で
始まって読みにくい。

---

## 9. 実装ステップと完了判定

| Step | 内容 | 完了判定 |
|---|---|---|
| 0 | プロジェクトセットアップ | `npm run dev` と `npm test` が通る |
| 1 | 型定義＋定義データ（電源 / 押しボタン A・B / MY4N / ランプ） | 型が通り、レジストリから定義を取得できる |
| 2 | エンジン（DSU・収束・コイル・接点・警告）＋検証回路テスト 1〜5 | **テスト 5 本が緑。UI はまだ無し** |
| 3 | キャンバス＋汎用 DeviceNode＋パレット D&D＋端子間配線 | 配置して端子どうしを繋げる |
| 4 | エンジン接続（▶実行・押しボタン・配線色・ランプ発光） | MVP 第一目標を画面上で達成 |
| 5 | プロパティパネル＋端子ツールチップ | 選択部品の状態がリアルタイム更新 |
| 6 | 保存 / 読込 / Undo / Redo / 警告表示 UI | リロード後に回路が復元 |
| 7 | MY2N / MY4N-D2 / 端子台 / ダイオード追加＋部品検索 | **エンジンを 1 行も変えずに部品が増える** ✅ `src/circuit/engine/` の差分 0 行で完了（§4.6） |
| 8 | 範囲選択（部品 / 配線・対象切り替え・1 手で削除） | 部品を含まない枠で配線だけを選べ、まとめて消しても Undo 1 回で戻る（§8.6） |
| 9 | 部品交換（接続を維持したまま定義を差し替える） | A 接点 → B 接点で配線が切れず、MY4N → MY2N では維持できる範囲の配線だけが残る。Undo 1 回で交換前に戻る（§7） ✅ |
| 10 | 操作ヘルプ＋停止中の配線チェック＋CI | `?` から操作一覧と §6 の制約を読め、▶ を押す前に未接続・短絡・ダイオードの向きが出る。push すると型検査・テスト・ビルドが CI で回る（§5.7・§8.10） |

**Step 2 を UI より先に置く理由:** 検証回路テスト 1〜5（自己保持・インターロックを含む）は UI を一切使わずに JSON で回路を組んで `simulate()` を呼べば検証できる。収束アルゴリズムのバグをブラウザで部品を並べ直しながら追うより、`npm test` で回すほうが桁違いに速い。

**Step 7 は設計の検証を兼ねる。** ここでエンジンの修正が必要になったら、データ駆動設計が破綻しているサインなので設計を見直す。

### 9.1 デプロイ（`.github/workflows/deploy.yml`）

**main に入った時点で本番。** `next.config.ts` の `output: "export"` で書き出した `out/` を、`wrangler.jsonc` の設定どおり Cloudflare Workers の静的アセットとして配る。バックエンドを持たない（CLAUDE.md）ので、配るものはこのディレクトリだけ。

手元から配るときも同じ経路を通す。

```
npm run deploy      # = npm run build && wrangler deploy
```

`wrangler` は **devDependencies に入れて `package-lock.json` で版を固定する**。`npx wrangler` のまま放置すると、手元と CI で別の版が走り、「手元では配れるのに CI では落ちる」を再現できない。

| 使う秘密情報 | 置き場所 | 無いと |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | リポジトリの Actions Secrets | 配布ステップだけが `You are not authenticated` で落ちる（テストとビルドは通る） |
| `CLOUDFLARE_ACCOUNT_ID` | 同上（トークンが 1 アカウントにしか届かないなら省略可） | 複数アカウントに届くトークンで配布先が定まらず落ちる |

**配布前にテストとビルドを回す。** `ci.yml` と重複するが、`workflow_dispatch` や main への直 push で「検証されていない配布経路」ができるのを防ぐため、このワークフロー単体で完結させる。

**`concurrency` で追い越しを止める。** `ci.yml` と違って `cancel-in-progress` は付けない —— `wrangler deploy` の途中で打ち切ると、どの版が本番に載っているのか分からなくなる。
