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
      CircuitCanvas.tsx
      ComponentPalette.tsx
      PropertiesPanel.tsx
      Toolbar.tsx
    nodes/
      DeviceNode.tsx             # 汎用ノード（定義駆動で描画）
      DeviceTerminal.tsx         # Handle + ツールチップ
      bodies/                    # カテゴリ固有の見た目差分のみ
        RelayBody.tsx
        SwitchBody.tsx
        PowerSupplyBody.tsx
        LampBody.tsx
        DiodeBody.tsx
        TerminalBlockBody.tsx

  circuit/
    engine/
      simulate.ts                # 収束ループ（エントリポイント）
      graph.ts                   # Union-Find とネット構築
      relay.ts                   # コイル判定・接点内部接続の生成
      validation.ts              # 短絡・極性・未接続の検出
    types/
      component.ts
      terminal.ts
      connection.ts
      circuit.ts
      simulation.ts
    definitions/
      index.ts                   # 全定義のレジストリ
      omron/
        my2n-dc24.ts
        my4n-dc24.ts
        my4n-d2-dc24.ts
      power.ts
      switches.ts
      lamps.ts
      diodes.ts
      terminals.ts
    adapter/
      reactflow.ts               # Node/Edge ⇄ CircuitDocument

  store/
    circuitStore.ts
    simulationStore.ts

  lib/
    app-info.ts                  # アプリ名・収束の最大反復回数など UI とエンジンの共有定数

  __tests__/
    setup.test.ts                # ツールチェーン疎通のスモークテスト

  circuit/engine/__tests__/
    scenarios.test.ts            # 検証回路 テスト1〜5
```

**テストの配置。** エンジンのテストは `src/circuit/engine/__tests__/` に置く。ツールチェーン自体の
疎通テストだけ `src/__tests__/` に分ける — `src/circuit/{types,definitions,engine}/` は
`check-docs-fresh.mjs` の監視対象で、ここにファイルを増やすと design.md の更新が要求されるため。

**要件書の構成からの変更点:** 型番ごとのノードコンポーネント（`RelayNode.tsx` 等）を作らず、汎用 `DeviceNode` が `ComponentDefinition` を読んで描画する。カテゴリ固有の差分（ランプの発光、押しボタンの押下表現）だけを `bodies/` に切り出す。これにより「新型番の追加＝定義ファイル 1 枚」を保証する。

---

## 3. 型定義

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

type TerminalDefinition = {
  id: string            // 内部ID。原則として端子番号と同じ文字列
  label: string         // 画面表示（"14" など）
  number?: string       // 実端子番号
  role: TerminalRole
  contactGroup?: string // "c1".."c4" — 同一接点に属する COM/NO/NC を束ねる
  description?: string  // ツールチップ本文（"コイル + / DC24V"）
  position: { x: number; y: number }  // 部品内の相対座標 0..1
  side: "top" | "right" | "bottom" | "left"  // React Flow Handle の向き
}

type ComponentDefinition = {
  id: string                 // "omron-my4n-dc24"
  manufacturer?: string
  model: string
  category: ComponentCategory
  terminals: TerminalDefinition[]
  electrical: ElectricalDefinition
  visual: { width: number; height: number }
  source?: string            // 端子データの出典URL
  verified: boolean          // 実機/データシートで検証済みか
}
```

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
type CircuitConnection = {
  id: string
  from: { componentId: string; terminalId: string }
  to:   { componentId: string; terminalId: string }
}

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

### 3.4 シミュレーション入出力

```ts
type SimulationInput = {
  pressedSwitches: Set<string>   // 押下中の componentId
}

type SimulationResult = {
  energizedRelays: Set<string>   // componentId
  litLamps: Set<string>
  netOf: Map<string, number>            // "compId:termId" → ネットID
  netState: Map<number, NetState>       // ネットID → 電位状態
  warnings: Warning[]
  status: "stable" | "oscillating" | "not-converged"
  iterations: number
}

type NetState = {
  reachesPlus: boolean
  reachesZero: boolean
}
```

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

**すべての定義ファイルに `verified: false` と `source` を記載して実装する。** ユーザーによる実機／公式データシート検証後に `verified: true` へ更新する。パレット上では未検証の型番にバッジを表示する。

参考にした資料:
- [OMRON MY シリーズ データシート (relayspec)](https://www.relayspec.com/specs/099/MY.pdf)
- [OMRON MY シリーズ データシート (Farnell)](https://www.farnell.com/datasheets/37045.pdf)
- [ミニパワーリレー MY 日本語データシート](https://s-tekt.com/manual/omron/my.pdf)
- [パワーリレーとソケットの端子番号 — でんきメモ](https://memo-labo.com/socket.php)
- [MY4N DC24 製品ページ — オムロン制御機器](https://www.ia.omron.com/product/item/7507/)

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

```ts
const MAX_SIMULATION_ITERATIONS = 100

function simulate(doc, defs, input): SimulationResult {
  let energized = new Set<string>()   // 初期状態は全リレー非励磁
  const history: string[] = []

  for (let i = 0; i < MAX_SIMULATION_ITERATIONS; i++) {
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

### 5.6 配線色の決定（要件書 §8 の具体化）

各ネットの `{ reachesPlus, reachesZero }` から決める。

| reachesPlus | reachesZero | 表示 |
|---|---|---|
| false | false | グレー（非通電） |
| true | false | 赤（+24V 側） |
| false | true | 青（0V 側） |
| true | true | 緑・太線・発光（通電中） |

色だけに依存しないよう、通電中は線幅と発光表現を併用する（要件書 §8）。

### 5.7 警告の検出（validation.ts）

| 警告 | 検出方法 |
|---|---|
| 電源短絡 | +24V 端子と 0V 端子が同一ネット |
| コイル極性逆 | §5.3 の `reverse` 判定 |
| 未接続端子 | どの `CircuitConnection` にも現れない端子 |
| 発振 | §5.5 の履歴一致 |
| 収束しない | 100 回反復して安定しない |

---

## 6. 既知の制約（MVP で許容する）

1. **負荷の直列接続は再現できない。** `+24V → L1 → L2 → 0V` では両方消灯になる（現実には両方が薄暗く点灯）。中間ネットがどちらの電源にも到達しないため。実務のリレー回路ではまず組まない配線であり、要件書 §30 の「電圧計算」フェーズで解決する。
2. **ダイオードの整流作用は再現しない**（§5.4）。
3. **電圧・電流・消費電力の数値は扱わない。** 導通の有無のみ。定格電圧の不一致（DC24V ランプに AC100V など）は MVP では検出しない。
4. **時間の概念がない。** タイマーリレー、接点のチャタリング、動作／復帰時間は扱わない。発振回路は「発振する」と判定するのみで、周期は再現しない。

これらは `PropertiesPanel` または初回起動時のヘルプで明示し、ユーザーが誤解しないようにする。

---

## 7. 状態管理

### circuitStore（保存対象＋履歴）

`CircuitDocument` 相当を保持する。Undo/Redo は `{ past: Doc[]; present: Doc; future: Doc[] }` を自前で持ち、**操作完了時にのみコミットする。**

React Flow のノード移動は毎フレーム `onNodesChange` を発火するため、変更を素直に履歴へ積むと 1 回のドラッグで数百件の履歴が生まれる。`onNodeDragStop` / 配線確定 / 部品追加 / 削除 のタイミングでのみスナップショットを取る。

### simulationStore（実行時のみ）

`running` / `pressedSwitches` / 最新の `SimulationResult` を保持。保存対象に含めない。押しボタンの `onMouseDown` / `onMouseUp` で `pressedSwitches` を更新し、変更のたびに `simulate()` を呼ぶ。

**ストアを分けた理由:** 保存対象とシミュレーション一時状態を混在させると、保存 JSON に実行時状態が混入し、Undo 履歴もシミュレーション中の変化で汚染される。

---

## 8. UI 設計方針

- レイアウト: 3 カラム（左 240px / 中央 flex / 右 280px）＋ 上部操作バー。中心はあくまでキャンバス
- トーン: クリーン・モダン・明るめ。余白を確保し、過剰な装飾はしない。古い CAD 風にはしない
- 端子: 半径 6px 以上を確保し、ホバーで 1.3 倍に拡大。配線ドラッグ中は接続可能な端子をハイライトし、接続不可の端子は減光する
- 端子ツールチップ: 「端子 14 / コイル + / DC24V」「端子 9 / 第1接点 COM」のように、初心者が端子の意味を理解できる文言を `TerminalDefinition.description` から表示する
- 部品の見た目: 写真の完全再現はしない。**実端子番号が視覚的に読み取れることを最優先**とし、メーカー名・型番・端子番号を明示する
- プロパティパネル: 型番・種別・コイル仕様・励磁状態・接点ごとの COM/NO/NC 導通状態をシミュレーション中はリアルタイム更新する

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
