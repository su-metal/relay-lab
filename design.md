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
      WarningList.tsx            # 診断（警告一覧・§8.4）
      WireLegend.tsx             # 停止中の配線色の凡例（§5.8）
      Toolbar.tsx
      palette-dnd.ts             # D&D の MIME と読み取り
      useSimulationSync.ts       # 入力変化 → simulate() の再実行トリガー（§8.2）
      useDocumentPersistence.ts  # LocalStorage への保存・復元の駆動（§8.4）
      useHistoryShortcuts.ts     # Undo / Redo のキーボード操作（§8.4）
      useFlipShortcut.ts         # F キーで選択部品を左右反転（§8.1）
      useRangeSelection.ts       # 範囲選択中の選択集合を毎フレーム決める（§8.6）
      range-selection.ts         # 範囲選択の対象（部品 / 配線）の型と表示文言（§8.6）
      keyboard.ts                # 自前ショートカット共通の入力欄除外（§8.1）
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
      potential.ts               # ネット電位の読み取り（atPlus / atZero / polarityAcross）
      validation.ts              # 短絡・極性・未接続の検出
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
      switches.ts
      lamps.ts
      diodes.ts
      terminals.ts
      __tests__/
        registry.test.ts         # レジストリ取得と §4.1〜§4.3 端子表の突き合わせ
        step7-scenarios.test.ts  # 追加部品の挙動（§4.6）
    persistence/
      document-storage.ts        # CircuitDocument ⇄ JSON と LocalStorage（§7）
      __tests__/
        document-storage.test.ts # 往復と壊れた保存データの検証
    adapter/
      reactflow.ts               # Node/Edge ⇄ CircuitDocument
      simulation-view.ts         # SimulationResult → 配線色・部品状態（§5.6・§8.2）
      wire-role.ts               # 停止中の配線の役割配色（§5.8）
      wire-lane.ts               # 配線の重なりを解く幹線のずらし量（§8.7）
      inspection.ts              # 選択部品 1 個の読み取り（§8.3）
      selection.ts               # 範囲選択の当たり判定（§8.6）
      __tests__/
        reactflow.test.ts        # 往復変換と重複配線の判定（§8.1）
        simulation-view.test.ts  # 配線色の導出（§5.6）
        wire-role.test.ts        # 停止中の役割配色（§5.8）
        wire-lane.test.ts        # レーン分離の割り当て（§8.7）
        inspection.test.ts       # 接点の開閉と停止中の区別（§8.3）
        selection.test.ts        # 枠と部品・配線の交差（§8.6）

  store/
    circuitStore.ts              # ドキュメント＋選択＋Undo/Redo 履歴（§7）
    simulationStore.ts           # 実行時状態のみ（§7）
    __tests__/
      circuitStore.test.ts       # 履歴のスナップショット地点（§7）

  lib/
    app-info.ts                  # アプリ名・収束の最大反復回数など UI とエンジンの共有定数
    component-display.ts         # 表示ラベル表（カテゴリ・端子役割・極性・電位）と
                                 # 実端子番号の有無
    component-search.ts          # パレットの絞り込み（§8.5）
    warning-display.ts           # 警告の並べ替えと束ね（§5.7・§8.4）
    __tests__/
      component-search.test.ts   # 検索の絞り込み規則（§8.5）

  __tests__/
    setup.test.ts                # ツールチェーン疎通のスモークテスト

  circuit/engine/__tests__/
    scenarios.test.ts            # 検証回路 テスト1〜5
```

**`potential.ts` を分けた理由。** 「+ 側にいる / 0V 側にいる」の解釈はコイル（`relay.ts`）とランプ（`simulate.ts`）の双方が必要とする。`graph.ts` に置くと `graph.ts → relay.ts → graph.ts` の循環参照になるため、依存の末端として独立させた。依存の向きは `potential.ts ← relay.ts ← graph.ts ← simulate.ts` の一本道。

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
  pressedSwitches: ReadonlySet<string>   // 押下中の componentId
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

`Warning` は §5.7 の 5 種に対応する。

```ts
type WarningCode =
  | "power-short-circuit"       // +24V と 0V が同一ネット
  | "coil-polarity-reversed"    // コイルに逆極性で電圧
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

`polarity` は `"indicator"`（逆接でも励磁するが表示 LED が点灯しない）。§4.4 の通りこの理解自体が要検証。

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

**MY4N との定義の差は `polarity` の 1 値だけ。** 端子・接点・コイル電圧はすべて一致する（`registry.test.ts` が両者を突き合わせて保証している）。エンジンはこの 3 値しか見ておらず型番を知らないので、逆接時の挙動の差はデータだけで再現される（§5.3）。

### 4.3.1 MY シリーズ定義の共有（`omron/my-series.ts`）

MY2N / MY4N / MY4N-D2 は端子番号の振り方が同じ系列で、差は **①使う接点行 ②コイルの極性** の 2 点しかない。§4.1 の端子表を型番ごとに手で写すと、片方を直してもう片方を直し忘れた瞬間に「実端子番号が正しい」という前提が崩れる。そこで表を 1 箇所に置き、各型番の定義ファイルは `defineMyRelay()` に引数を渡すだけにした。

| 型番 | 接点行 | `polarity` | `visual` |
|---|---|---|---|
| MY2N | §4.2（2 行） | `indicator` | 210×200 |
| MY4N | §4.1（4 行） | `indicator` | 260×220 |
| MY4N-D2 | §4.1（4 行） | `strict` | 260×220 |

**`my-series.ts` にも型番分岐は書かない**（CLAUDE.md 設計原則 2）。型番ごとの差は呼び出し側が渡す引数だけで表現する。系列の違う型番（LY・G2R など）を足すときは、この表を共有せず別のファイルを立てる。

### 4.4 データの確度と検証状態

| 項目 | 確度 | 根拠 |
|---|---|---|
| MY4N 接点 NC=1-4 / NO=5-8 / COM=9-12 | 高 | 英語圏資料と日本語資料が独立に一致 |
| MY4N コイル 13=(−) / 14=(+) | 高 | オムロン MY データシートに MY3N のコイル「10=(−), 11=(+)」の明記あり、MY4N も同順。日本語解説記事とも一致 |
| MY2N 接点 1-5-9 / 4-8-12 | 高 | 複数資料が一致 |
| MY4N-D2 の逆接時挙動 | 中 | データシートに「DC タイプの極性を逆にしないこと」の注記はあるが、逆接時の具体的挙動の明記は未確認 |
| MY2N / MY4N（-D2 なし）DC タイプの極性 | **要検証** | 「N」は表示 LED 付きを意味し、データシートに「DC タイプは極性に注意」の注記がある。コイル自体は無極性で逆接でも励磁するが表示 LED が点灯しない、という理解で `polarity: "indicator"` としている。実機での確認が必要 |
| 汎用部品（電源 / 押しボタン / ランプ / ダイオード / 端子台）の端子呼称 | 実端子番号ではない | §4.5。実型番を持たないため検証対象そのものが存在しない |

**すべての定義ファイルに `verified: false` と `source` を記載して実装する。** ユーザーによる実機／公式データシート検証後に `verified: true` へ更新する。パレット上では未検証の型番にバッジを表示する。

参考にした資料:
- [OMRON MY シリーズ データシート (relayspec)](https://www.relayspec.com/specs/099/MY.pdf)
- [OMRON MY シリーズ データシート (Farnell)](https://www.farnell.com/datasheets/37045.pdf)
- [ミニパワーリレー MY 日本語データシート](https://s-tekt.com/manual/omron/my.pdf)
- [パワーリレーとソケットの端子番号 — でんきメモ](https://memo-labo.com/socket.php)
- [MY4N DC24 製品ページ — オムロン制御機器](https://www.ia.omron.com/product/item/7507/)

### 4.5 汎用部品の端子呼称（電源 / 押しボタン / ランプ / ダイオード / 端子台）

この 6 定義は実型番を持たないため、**実端子番号も存在しない。** 実型番の端子番号と混同させないよう、次の扱いで統一する。

| 定義 ID | 型番表示 | 端子ラベル | 役割 |
|---|---|---|---|
| `power-dc24v` | DC24V 電源 | `+24V` / `0V` | `power_positive` / `power_zero` |
| `switch-pushbutton-no` | 押しボタン A接点（モーメンタリ） | `1` / `2` | `common` / `normally_open` |
| `switch-pushbutton-nc` | 押しボタン B接点（モーメンタリ） | `1` / `2` | `common` / `normally_closed` |
| `lamp-dc24v` | DC24V 表示ランプ | `1` / `2` | `generic` / `generic`（極性なし） |
| `diode-generic` | 汎用ダイオード | `A` / `K` | `anode` / `cathode` |
| `terminal-block-6p` | 汎用端子台 6P（全極短絡） | `1` 〜 `6` | すべて `generic` |

ダイオードのラベルを `1` / `2` にしないのは、**この部品では向きだけが情報**だから。番号を振ると「1 が入力」という無い決まりを読ませてしまう。端子台の `1`〜`6` は端子台に振られた通し番号であって、型番ごとに決まった実端子番号ではないため `number` は持たせない（上段 1・2・3 / 下段 4・5・6 に配置する）。

- `TerminalDefinition.number`（実端子番号）は**持たせない**。ラベルはあくまで呼称
- `source` には URL ではなく `definitions/source-notes.ts` の `GENERIC_TERMINAL_SOURCE`（実端子番号ではない旨の定型文）を入れる。`verified` は実型番と同じく `false`

**押しボタンに IEC 慣例の 13-14（a 接点）/ 11-12（b 接点）を当てる案は採らない。** MY4N のコイル 13 / 14 と番号が衝突し、初学者が「実端子番号どうしを繋いでいる」と誤解する。本プロダクトの価値は実端子番号の正しさにあるので、実在しない番号を実在するかのように見せる方が害が大きい。

### 4.6 追加部品の挙動（Step 7 で確定）

Step 7 の 4 部品はいずれも既存のエンジンの分岐（`ElectricalDefinition.kind`）に載るだけで、**`src/circuit/engine/` の差分は 0 行**。挙動は `definitions/__tests__/step7-scenarios.test.ts` で回路を組んで検証する。

| 部品 | 依拠する仕組み | 期待する挙動 |
|---|---|---|
| MY2N | `RelayDefinition.contacts` が 2 要素 | 飛び番の端子で配線でき、励磁で 2 回路が同時に切り替わる。存在しない端子（2・3・6・7・10・11）はネットにも現れない |
| MY4N-D2 | `CoilPolarity: "strict"`（§5.3） | 逆接で励磁せず `error`。同じ配線で MY4N / MY2N は励磁し `warning` に留まる |
| 端子台 | `kind: "terminal"`（§5.1 で union する） | 1 端子に入れた電位が全端子に回る。**導線なので +24V と 0V を渡せば短絡になる** |
| ダイオード | `kind: "diode"`（§5.4 で union しない） | 順方向でも 2 端子は別ネット。電源に直結しても短絡と判定されない（負荷と同じ扱い） |

**このテストを `engine/__tests__/` に置かないのは意図的。** 検証対象は定義データであってエンジンではなく、engine の差分を 0 行に保つこと自体が Step 7 の完了判定だから（§9）。

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
- ダイオードの 2 端子（§5.4 参照）

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
  case "none":      energized = forward || reverse; break
  case "indicator": energized = forward || reverse
                    indicatorOn = forward
                    if (reverse) warn("極性が逆です（表示灯が点灯しません）")
                    break
  case "strict":    energized = forward
                    if (reverse) warn("コイルの極性が逆です") // 内蔵ダイオード順方向
                    break
}
```

`polarity` を 3 値にしたのは、実機の挙動が「励磁するか / しないか」の 2 値ではないため。MY4N-D2 は逆接で励磁しないが、MY2N / MY4N は逆接でも励磁して表示灯だけ点かない。この差を再現できることが「実機を配線する前の確認」というプロダクト価値に直結する。**エンジンには型番分岐を書かず、この 3 値だけで分岐する。**

### 5.4 ダイオードの扱い（MVP では非導通）

単体ダイオードは一方向にしか導通しないため、無向グラフである DSU では原理的に表現できない。MVP では**ダイオードを常に開放（非導通）として扱い**、見た目とプロパティ表示のみ提供する。MY4N-D2 の内蔵ダイオードも導通させず、極性判定にのみ使う。

有向導通が必要になった段階で、DSU を「+側からの前方到達可能性 / 0側からの後方到達可能性」の 2 パス探索に差し替える。`SimulationResult` のインターフェースは変わらないため、UI 側への影響なく置換できる。

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
type WireState = "inactive" | "plus" | "zero" | "energized" | "short"
```

| 値 | 条件 | 表示 |
|---|---|---|
| `inactive` | どちらにも到達しない | グレー・2px |
| `plus` | + 側のみ | 赤 |
| `zero` | 0V 側のみ | 青 |
| `energized` | 通電中の負荷に隣接するネット | 緑・3.5px・発光 |
| `short` | 両方に到達 | 赤・3.5px・点滅 |

判定順は **`short` を最初に置く。** 短絡したネットを緑（正常な通電）として描くと、最も危険な配線ミスが最も安全に見える。

「通電中の負荷に隣接するネット」は、励磁したコイルの `positiveTerminal` / `negativeTerminal` と、点灯したランプの 2 端子が属するネットを集めて求める。負荷は union されていない（§5.2）ので、電流の経路はこの 2 点からしか辿れない。

同じ `WireState` を**端子の色にも使う。** 端子を無彩色のままにすると、接点の先で色が途切れて配線が切れているように見える。

### 5.7 警告の検出（validation.ts）

| 警告 | `WarningCode` | 既定の `severity` | 検出方法 |
|---|---|---|---|
| 電源短絡 | `power-short-circuit` | error | +24V 端子と 0V 端子が同一ネット |
| コイル極性逆 | `coil-polarity-reversed` | `strict` は error / `indicator` は warning | §5.3 の `reverse` 判定 |
| 未接続端子 | `unconnected-terminal` | info | どの `CircuitConnection` にも現れない端子 |
| 発振 | `oscillating` | info | §5.5 の履歴一致 |
| 収束しない | `not-converged` | error | 100 回反復して安定しない |

### 5.8 停止中の役割配色（`adapter/wire-role.ts`）

§5.6 の `WireState` は **シミュレーション中**の色であり、停止中はすべて灰色になる。だが図面を描いている時間の大半は停止中で、その間まったく色の手がかりが無い。ここでは実務の盤配線と同じ考え方 —— 常時 + 側は赤、0V は青、接点を介して電源につながる制御線は黄 —— を、**回路を動かさずに**割り当てる。

判定は **2 回のネット構築**（§5.1）だけで済む。`simulate()` の収束ループ（§5.5）は回さない。

| 呼び出し | `pressedSwitches` / `energizedRelays` | 読み取れること |
|---|---|---|
| 静止状態 | 空 | 電源に直結している線（赤 / 青） |
| 全動作状態 | 全部品の ID | 接点を閉じれば電源に届く線（黄） |

全動作状態も取るのは、**A 接点の先の線が静止状態ではどの電源にも到達せず、「配線し忘れた線」と区別できない**ため。両方で届かない線だけが灰になるので、**灰は「まだ電源につながっていない」の意味を持つ**（配線漏れの手がかりになる）。B 接点は動作させると開くので、静止状態で電源に届く線は赤 / 青のままになる。

`buildNets` は部品の `kind` に応じた集合しか見ないので、押下スイッチと励磁リレーの両方に全 ID を渡してよい。**この 1 点により、役割配色の側に部品種別の分岐が要らない。**

| `WireRole` | 条件（判定順） | 表示 |
|---|---|---|
| `short` | 静止状態で + と 0V の両方に到達 | 赤・3.5px・点滅（§5.6 と同じクラス） |
| `plus` | 静止状態で + 側のみ | 赤 |
| `zero` | 静止状態で 0V 側のみ | 青 |
| `control` | 全動作状態でどちらかの電源に到達 | 黄（`--wire-control`） |
| `isolated` | どちらでも到達しない | 灰・破線 |

判定順が §5.6 と同じく **`short` 先頭**なのも同じ理由 —— 最も危険な配線ミスを最も安全な見た目にしない。停止中に見つけた短絡を大人しい色にすると、実行した瞬間に色が変わって初めて気付くことになる。

**役割色と状態色は排他。** 実行中（`SimulationResult` がある間）は役割色を計算せず、§5.6 の状態色だけを載せる。同じ線に 2 つの意味が同時に乗ると、色が「役割」なのか「今の電位」なのか読み手が判断できない。+ 側 / 0V 側だけは両方で同じ赤・青を使う（停止と実行で同じ線の色が変わらない）。

**負荷は役割配色でも union しない**（§5.2）。ランプを跨いだ先の線は `plus` にならず、`control` か `isolated` になる。

**凡例（`WireLegend.tsx`）。** 赤＝+ 側・青＝0V は実務と同じで説明が要らないが、**灰の破線＝どこにも電源が届いていない、は読み取れない。** 凡例が無いとこの色分けは「なんとなく色が付いている」で終わるため、停止中かつ配線が 1 本以上あるときだけキャンバス右下に出す。実行中は色の意味が §5.6 へ切り替わるので出さない。

---

## 6. 既知の制約（MVP で許容する）

1. **負荷の直列接続は再現できない。** `+24V → L1 → L2 → 0V` では両方消灯になる（現実には両方が薄暗く点灯）。中間ネットがどちらの電源にも到達しないため。実務のリレー回路ではまず組まない配線であり、要件書 §30 の「電圧計算」フェーズで解決する。
2. **ダイオードの整流作用は再現しない**（§5.4）。
3. **電圧・電流・消費電力の数値は扱わない。** 導通の有無のみ。定格電圧の不一致（DC24V ランプに AC100V など）は MVP では検出しない。
4. **時間の概念がない。** タイマーリレー、接点のチャタリング、動作／復帰時間は扱わない。発振回路は「発振する」と判定するのみで、周期は再現しない。
5. **同時に変化する入力の競合は解けない。** すべてのコイルを一斉に評価するため、相互 b 接点のインターロック回路で全 OFF から 2 つの起動ボタンを同時に押した場合、実機のように「わずかに早い方が勝つ」のではなく `oscillating` になる（§5.5）。動作時間を持たない以上、どちらが勝つかを決める根拠が無い。
6. **範囲選択の配線判定は両端子を結ぶ直線で行う**（§8.6）。実際の描画は `smoothstep` の折れ線なので、大きく回り込んだ配線では見た目の線と判定線がずれる。実路を使うには描画後の DOM を測る必要があり、判定を純粋関数として検証できなくなる。
7. **`simulate()` は履歴を持たない純粋関数。** 自己保持のような双安定回路の状態は呼び出し側が `previousEnergizedRelays` で繋ぐ（§3.4）。渡し忘れると自己保持が毎回解けてしまうため、`simulationStore` 側で必ず前回結果を渡すこと。

これらは `PropertiesPanel` または初回起動時のヘルプで明示し、ユーザーが誤解しないようにする。

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

### simulationStore（実行時のみ）

`running` / `pressedSwitches` / 最新の `SimulationResult` を保持。保存対象に含めない。押しボタンの `onPointerDown` / `onPointerUp` で `pressedSwitches` を更新し、変更のたびに `simulate()` を呼ぶ。

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
`addConnection` の両方から呼ぶ。

**キャンバス操作。** 左ドラッグ＝範囲選択、**Shift+ドラッグ＝画面移動（パン）**、
Ctrl/Cmd+クリック＝複数選択、Delete / Backspace / **D** ＝削除、**F** ＝選択中の部品を左右反転。
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
この除外を自分で実装すること**（`useHistoryShortcuts` の `isTextEntry` が同じ役割）。

**「未検証」バッジは実端子番号を持つ型番にだけ出す。** 汎用部品（電源 / 押しボタン / ランプ）は
`verified: false` だが実端子番号そのものが無く、検証対象が存在しない（§4.4 / §4.5）。
そこへ同じバッジを出すと全部品に付いて意味を失うので、パレットとプロパティパネルでは
「実端子番号なし」と無彩色で表示し、バッジは MY4N 等に限る。判定は
`lib/component-display.ts` の `hasRealTerminalNumbers()`。

**`visual` は端子番号の可読性で決める。** 型番表示が図記号を押し出さない大きさが必要で、
汎用部品の「型番」は長い日本語（"押しボタン A接点（モーメンタリ）"）になる。
Step 3 で 押しボタン 160×125 / 電源 150×110 / ランプ 140×130 / MY4N 260×220 に調整した。

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

**停止中は「指摘なし」ではなく「未実行」と出す。** 診断していないことと、
診断して何も出なかったことは別物（§8.2 の `undefined` と同じ約束）。

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
| 9 | 部品交換（接続を維持したまま定義を差し替える） | A 接点 → B 接点で配線が切れず、MY4N → MY2N では維持できる範囲の配線だけが残る。Undo 1 回で交換前に戻る（§7） |

**Step 2 を UI より先に置く理由:** 検証回路テスト 1〜5（自己保持・インターロックを含む）は UI を一切使わずに JSON で回路を組んで `simulate()` を呼べば検証できる。収束アルゴリズムのバグをブラウザで部品を並べ直しながら追うより、`npm test` で回すほうが桁違いに速い。

**Step 7 は設計の検証を兼ねる。** ここでエンジンの修正が必要になったら、データ駆動設計が破綻しているサインなので設計を見直す。
