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
      Toolbar.tsx
      palette-dnd.ts             # D&D の MIME と読み取り
      useSimulationSync.ts       # 入力変化 → simulate() の再実行トリガー（§8.2）
      useDocumentPersistence.ts  # LocalStorage への保存・復元の駆動（§8.4）
      useHistoryShortcuts.ts     # Undo / Redo のキーボード操作（§8.4）
      *.module.css
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
        DiodeBody.tsx            # Step 7
        TerminalBlockBody.tsx    # Step 7

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
        my2n-dc24.ts
        my4n-dc24.ts
        my4n-d2-dc24.ts
      power.ts
      switches.ts
      lamps.ts
      diodes.ts
      terminals.ts
      __tests__/
        registry.test.ts         # レジストリ取得と §4.1 端子表の突き合わせ
    persistence/
      document-storage.ts        # CircuitDocument ⇄ JSON と LocalStorage（§7）
      __tests__/
        document-storage.test.ts # 往復と壊れた保存データの検証
    adapter/
      reactflow.ts               # Node/Edge ⇄ CircuitDocument
      simulation-view.ts         # SimulationResult → 配線色・部品状態（§5.6・§8.2）
      inspection.ts              # 選択部品 1 個の読み取り（§8.3）
      __tests__/
        reactflow.test.ts        # 往復変換と重複配線の判定（§8.1）
        simulation-view.test.ts  # 配線色の導出（§5.6）
        inspection.test.ts       # 接点の開閉と停止中の区別（§8.3）

  store/
    circuitStore.ts              # ドキュメント＋選択＋Undo/Redo 履歴（§7）
    simulationStore.ts           # 実行時状態のみ（§7）
    __tests__/
      circuitStore.test.ts       # 履歴のスナップショット地点（§7）

  lib/
    app-info.ts                  # アプリ名・収束の最大反復回数など UI とエンジンの共有定数
    component-display.ts         # 表示ラベル表（カテゴリ・端子役割・極性・電位）と
                                 # 実端子番号の有無
    warning-display.ts           # 警告の並べ替えと束ね（§5.7・§8.4）

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
  }[]
  connections: CircuitConnection[]
  viewport: { x: number; y: number; zoom: number }
}
```

`terminalKey()` を関数にしてあるのは、キー書式を 1 箇所に閉じるため。各所で `` `${a}:${b}` `` を手書きすると、書式がずれた瞬間にネット引きが静かに失敗する。

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

第 i 接点について「上が NC、下が NO、右が COM」で必ず揃い、3 端子は `contactGroup: "c1".."c4"` で束ねられる。定義ファイル (`omron/my4n-dc24.ts`) では上表と同じ 4 行のテーブルから 12 端子を生成しており、端子表とコードが 1 対 1 に対応する。

### 4.2 OMRON MY2N DC24V — 8 ピン（ソケット PYF08A 系）

| 接点 | NC（b接点） | NO（a接点） | COM |
|---|---|---|---|
| 1 回路目 | 1 | 5 | 9 |
| 2 回路目 | 4 | 8 | 12 |

コイル: **13 = (−) / 14 = (+)**

MY4N の 1 回路目と 4 回路目だけを使った配置になっており、8 ピンだが端子番号は 1〜14 の中の 8 個が飛び番で振られる。**この飛び番を正しく表示することが本アプリの価値の中核なので、1〜8 に詰め直してはならない。**

### 4.3 OMRON MY4N-D2 DC24V

端子配置は MY4N と同一。コイルに逆起電力吸収ダイオードを内蔵し、**極性を逆にすると内蔵ダイオードが順方向になるため励磁せず、電源短絡状態になる。** `polarity: "strict"` として扱う。

### 4.4 データの確度と検証状態

| 項目 | 確度 | 根拠 |
|---|---|---|
| MY4N 接点 NC=1-4 / NO=5-8 / COM=9-12 | 高 | 英語圏資料と日本語資料が独立に一致 |
| MY4N コイル 13=(−) / 14=(+) | 高 | オムロン MY データシートに MY3N のコイル「10=(−), 11=(+)」の明記あり、MY4N も同順。日本語解説記事とも一致 |
| MY2N 接点 1-5-9 / 4-8-12 | 高 | 複数資料が一致 |
| MY4N-D2 の逆接時挙動 | 中 | データシートに「DC タイプの極性を逆にしないこと」の注記はあるが、逆接時の具体的挙動の明記は未確認 |
| MY2N / MY4N（-D2 なし）DC タイプの極性 | **要検証** | 「N」は表示 LED 付きを意味し、データシートに「DC タイプは極性に注意」の注記がある。コイル自体は無極性で逆接でも励磁するが表示 LED が点灯しない、という理解で `polarity: "indicator"` としている。実機での確認が必要 |
| 汎用部品（電源 / 押しボタン / ランプ）の端子呼称 | 実端子番号ではない | §4.5。実型番を持たないため検証対象そのものが存在しない |

**すべての定義ファイルに `verified: false` と `source` を記載して実装する。** ユーザーによる実機／公式データシート検証後に `verified: true` へ更新する。パレット上では未検証の型番にバッジを表示する。

参考にした資料:
- [OMRON MY シリーズ データシート (relayspec)](https://www.relayspec.com/specs/099/MY.pdf)
- [OMRON MY シリーズ データシート (Farnell)](https://www.farnell.com/datasheets/37045.pdf)
- [ミニパワーリレー MY 日本語データシート](https://s-tekt.com/manual/omron/my.pdf)
- [パワーリレーとソケットの端子番号 — でんきメモ](https://memo-labo.com/socket.php)
- [MY4N DC24 製品ページ — オムロン制御機器](https://www.ia.omron.com/product/item/7507/)

### 4.5 汎用部品の端子呼称（電源 / 押しボタン / ランプ）

この 3 種は実型番を持たないため、**実端子番号も存在しない。** 実型番の端子番号と混同させないよう、次の扱いで統一する。

| 定義 ID | 型番表示 | 端子ラベル | 役割 |
|---|---|---|---|
| `power-dc24v` | DC24V 電源 | `+24V` / `0V` | `power_positive` / `power_zero` |
| `switch-pushbutton-no` | 押しボタン A接点（モーメンタリ） | `1` / `2` | `common` / `normally_open` |
| `switch-pushbutton-nc` | 押しボタン B接点（モーメンタリ） | `1` / `2` | `common` / `normally_closed` |
| `lamp-dc24v` | DC24V 表示ランプ | `1` / `2` | `generic` / `generic`（極性なし） |

- `TerminalDefinition.number`（実端子番号）は**持たせない**。ラベルはあくまで呼称
- `source` には URL ではなく `definitions/source-notes.ts` の `GENERIC_TERMINAL_SOURCE`（実端子番号ではない旨の定型文）を入れる。`verified` は実型番と同じく `false`

**押しボタンに IEC 慣例の 13-14（a 接点）/ 11-12（b 接点）を当てる案は採らない。** MY4N のコイル 13 / 14 と番号が衝突し、初学者が「実端子番号どうしを繋いでいる」と誤解する。本プロダクトの価値は実端子番号の正しさにあるので、実在しない番号を実在するかのように見せる方が害が大きい。

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

---

## 6. 既知の制約（MVP で許容する）

1. **負荷の直列接続は再現できない。** `+24V → L1 → L2 → 0V` では両方消灯になる（現実には両方が薄暗く点灯）。中間ネットがどちらの電源にも到達しないため。実務のリレー回路ではまず組まない配線であり、要件書 §30 の「電圧計算」フェーズで解決する。
2. **ダイオードの整流作用は再現しない**（§5.4）。
3. **電圧・電流・消費電力の数値は扱わない。** 導通の有無のみ。定格電圧の不一致（DC24V ランプに AC100V など）は MVP では検出しない。
4. **時間の概念がない。** タイマーリレー、接点のチャタリング、動作／復帰時間は扱わない。発振回路は「発振する」と判定するのみで、周期は再現しない。
5. **同時に変化する入力の競合は解けない。** すべてのコイルを一斉に評価するため、相互 b 接点のインターロック回路で全 OFF から 2 つの起動ボタンを同時に押した場合、実機のように「わずかに早い方が勝つ」のではなく `oscillating` になる（§5.5）。動作時間を持たない以上、どちらが勝つかを決める根拠が無い。
6. **`simulate()` は履歴を持たない純粋関数。** 自己保持のような双安定回路の状態は呼び出し側が `previousEnergizedRelays` で繋ぐ（§3.4）。渡し忘れると自己保持が毎回解けてしまうため、`simulationStore` 側で必ず前回結果を渡すこと。

これらは `PropertiesPanel` または初回起動時のヘルプで明示し、ユーザーが誤解しないようにする。

---

## 7. 状態管理

### circuitStore（保存対象＋履歴）

`CircuitDocument` 相当を保持する。Undo/Redo は `{ past: Doc[]; present: Doc; future: Doc[] }` を自前で持ち、**操作完了時にのみコミットする。**

React Flow のノード移動は毎フレーム `onNodesChange` を発火するため、変更を素直に履歴へ積むと 1 回のドラッグで数百件の履歴が生まれる。`onNodeDragStop` / 配線確定 / 部品追加 / 削除 のタイミングでのみスナップショットを取る。

#### Undo / Redo の実装（Step 6 で確定）

**ドラッグはスナップショットを「開始時」に控え、「完了時」に積む。** `onNodeDragStop` の時点で現在のドキュメントを past へ積むと、戻る先が移動後の位置になり Undo が効かない。`beginComponentDrag()` がドラッグ開始時のドキュメントを控え、`endComponentDrag()` が **位置が実際に変わっていた場合だけ** それを past へ積む。掴んだだけの操作で履歴を汚さない。

控えたドキュメントは **ストアの state ではなくモジュール変数**に置く。履歴でも保存対象でもない一時値であり、`document` の購読者をドラッグのたびに起こす理由が無い。

**削除は 1 手にまとめる。** `removeSelected()` が `removeConnections()` → `removeComponents()` と順に呼ぶと履歴が 2 手ぶん積まれ、1 回の削除を戻すのに Undo を 2 回押すことになる。部品と配線を 1 回の `set` で落とす。

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

**キャンバス操作。** 左ドラッグ＝パン、Shift+ドラッグ＝範囲選択、Ctrl/Cmd+クリック＝複数選択、
Delete / Backspace ＝削除。左ドラッグを範囲選択にすると、配線しようとして端子を掴み損ねる
たびに選択枠が出てパンできなくなるため採らない。

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
| 7 | MY2N / MY4N-D2 / 端子台 / ダイオード追加＋部品検索 | **エンジンを 1 行も変えずに部品が増える** |

**Step 2 を UI より先に置く理由:** 検証回路テスト 1〜5（自己保持・インターロックを含む）は UI を一切使わずに JSON で回路を組んで `simulate()` を呼べば検証できる。収束アルゴリズムのバグをブラウザで部品を並べ直しながら追うより、`npm test` で回すほうが桁違いに速い。

**Step 7 は設計の検証を兼ねる。** ここでエンジンの修正が必要になったら、データ駆動設計が破綻しているサインなので設計を見直す。
