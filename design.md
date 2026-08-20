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
      LadderDialog.tsx           # ラダー図。表示だけを受け持つ（§8.15）
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
      useViewportMode.ts         # 画面の狭さ（data-compact）と指かどうかの判定（§8.12）
      place-component.ts         # タップで置く座標と、画面外へ出さない寄せ（§8.12・純粋関数）
      auto-arrange.ts            # 整理の呼び出し口。ボタンと L キーの共通経路（§8.9）
      align-components.ts        # 「揃える」の呼び出し口とメニュー項目（§8.13）
      usePathPreview.ts          # 経路確認モードの解を 1 箇所で組む（§8.14）
      PathPreviewList.tsx        # 電位が止まっている箇所の一覧（§8.14）
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
        TimerBody.tsx            # タイマー（限時接点＋残り時間・§5.13）
        ContactDiagram.tsx       # 接点の図記号。RelayBody / TimerBody で共有（§8.11）
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
      graph.ts                   # Union-Find とネット構築（`UnionFind` は §5.16 でも使う）
      relay.ts                   # コイル判定・接点内部接続の生成
      timer.ts                   # 限時の状態遷移とコイル／接点の見分け（§5.13）
      diode.ts                   # ダイオードの有向導通と向きの判定（§5.4）
      potential.ts               # ネット電位の読み取り（atPlus / atZero / polarityAcross）
      validation.ts              # 短絡・極性・ダイオードの向き・未接続の検出
      chatter.ts                 # 自分の接点で自分のコイルを切る配線の検出（§5.14）
      wiring.ts                  # 静止状態の配線チェック（電源を入れる前の指摘・§5.7）
      preview.ts                 # 静止状態の到達範囲と、電位が止まっている箇所（§5.15）
      analog.ts                  # 0–10V のアナログ量を導通レイヤに重ねる第 2 パス（§5.17）
      fade.ts                    # 調光出力の電圧が時間をかけて動く（§5.18）
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
        g7l-series.ts            # G7L シリーズ共通の端子生成（§4.8）
        g7l-1a-b-dc24.ts
        g7l-2a-b-dc24.ts
        s8vm-05024.ts           # AC-DC スイッチング電源（§4.18）
      power.ts
      switches.ts                # 押しボタン／切替スイッチ 4 種（§4.5・§4.7）
      timers.ts                  # 汎用タイマー 2 種（オンディレイ／オフディレイ・§4.10）
      lamps.ts
      diodes.ts
      terminals.ts
      __tests__/
        registry.test.ts         # レジストリ取得と §4.1〜§4.3 端子表の突き合わせ
        step7-scenarios.test.ts  # 追加部品の挙動（§4.6）
        switch-scenarios.test.ts # 切替スイッチ（オルタネート）の挙動（§4.7）
        g7l-scenarios.test.ts    # a 接点のみのパワーリレーの挙動（§4.8）
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
      path-graph.ts              # 経路グラフ・橋・2辺連結成分（§5.9〜§5.11 の共通土台）
      self-hold.ts               # 自己保持しているリレーと保持経路の検出（§5.9）
      current-flow.ts            # 配線 1 本ごとの電流の向き（§5.10）
      load-path.ts               # 負荷の通電経路・通電しない理由（§5.11）と
                                 # 起動経路・落とし方（§5.12）
      wire-lane.ts               # 配線の重なりを解く幹線のずらし量（§8.7）
      inspection.ts              # 選択部品 1 個の読み取り（§8.3）
      selection.ts               # 範囲選択の当たり判定（§8.6）
      auto-layout.ts             # 配置の自動整理（グリッド吸着・整列・重なり解消・§8.9）
      align.ts                   # 選択した部品を揃える・均等に並べる（§8.13）
      path-preview.ts            # 経路確認モードの配線色と止まっている箇所の文言（§5.15・§8.14）
      ladder.ts                  # 実体配線 → ラダー図（直列・並列への縮約・§5.16）
      __tests__/
        reactflow.test.ts        # 往復変換と重複配線の判定（§8.1）
        simulation-view.test.ts  # 配線色の導出（§5.6）
        wire-role.test.ts        # 停止中の役割配色と b 接点チェーンの誤検出（§5.8）
        self-hold.test.ts        # 自己保持の検出と保持経路の絞り込み（§5.9）
        current-flow.test.ts     # 電流の向きと、向きを出さない並列区間（§5.10）
        load-path.test.ts        # 通電経路の言語化・通電しない理由（§5.11）と
                                 # 起動経路・落とし方（§5.12）
        path-preview.test.ts     # 経路確認モードの配線色と止まっている箇所（§5.15）
        wire-lane.test.ts        # レーン分離の割り当て（§8.7）
        inspection.test.ts       # 接点の開閉と停止中の区別（§8.3）
        selection.test.ts        # 枠と部品・配線の交差（§8.6）
        auto-layout.test.ts      # 整列のクラスタリングと重なり解消（§8.9）
        ladder.test.ts           # ラダー図への変換（自己保持の並列・出せない配線・§5.16）

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
    relay.test.ts                # 接点の開閉規則。a 接点のみの扱い（§5.1）
    timer.test.ts                # 限時の境界・電源投入直後・引き継ぎ（§5.13）
    preview.test.ts              # 静止状態の到達範囲と止まっている箇所（§5.15）
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
| `component.ts` | `ComponentCategory` / `CoilPolarity` / `RelayContact` / `RelayDefinition` / `TimerDelay` / `AnalogCurve` / `DimmingInput` / `ElectricalDefinition` / `ComponentDefinition` / `ComponentDefinitionRegistry` |
| `connection.ts` | `TerminalRef` / `CircuitConnection` / `terminalKey()` |
| `circuit.ts` | `CircuitComponentInstance` / `CircuitDocument` |
| `simulation.ts` | `SimulationInput` / `NetState` / `TimerState` / `AnalogSignal` / `DimmingLevel` / `AnalogResult` / `WarningCode` / `WarningSeverity` / `Warning` / `SimulationStatus` / `SimulationResult` |

### 3.1 部品定義

```ts
type ComponentCategory =
  | "power" | "relay" | "switch" | "lamp" | "diode" | "terminal"
  | "timer"   // 電気的には relay のまま。パレットと図記号の出し分けだけ（§5.13）
  | "dimmer"  // 0–10V の調光出力。こちらは電気的にも別（analog-source・§5.17）

type TerminalRole =
  | "power_positive" | "power_zero"
  | "power_line" | "power_neutral"             // 交流の L / N（§4.13）
  | "coil_positive" | "coil_negative"
  | "coil"                                     // 極性を持たないコイル端子（§4.8）
  | "common" | "normally_open" | "normally_closed"
  | "anode" | "cathode"
  | "analog_signal" | "analog_common"          // 0–10V の信号線とその基準（§5.17）
  | "generic"

type TerminalSide = "top" | "right" | "bottom" | "left"  // React Flow Handle の向き

type TerminalDefinition = {
  id: string            // 内部ID。原則として端子番号と同じ文字列
  label: string         // 画面表示（"14" など）
  number?: string       // 実端子番号。汎用部品は持たない（§4.5）
  role: TerminalRole
  contactGroup?: string // "c1".."c4" — 同一接点に属する端子を束ねる（c 接点なら COM/NO/NC）
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
  communication?: CommunicationDefinition  // 通信の面（§4.17）。electrical と並ぶ別の面
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
  | { kind: "ac-dc-power-supply";             // 入力成立時だけ絶縁 DC 出力を生成（§4.18・§5.20）
      ratedInputVoltageMin: number; ratedInputVoltageMax: number;
      allowableInputVoltageMin: number; allowableInputVoltageMax: number;
      lineTerminal: string; neutralTerminal: string;
      outputVoltage: number; positiveTerminal: string; zeroTerminal: string;
      ratedOutputCurrent?: number; ratedPower?: number }
  | { kind: "relay";  relay: RelayDefinition }
  | { kind: "switch"; contactType: "NO" | "NC"; action: "momentary" | "maintained";
      terminalA: string; terminalB: string }
  | { kind: "lamp";   voltage: number; currentType: "DC" | "AC";
      terminalA: string; terminalB: string
      dimming?: DimmingInput }                  // 持つものが調光ランプ（§5.17）
  | { kind: "diode";  anodeTerminal: string; cathodeTerminal: string }
  | { kind: "terminal"; terminals: string[] }   // 全端子が常時導通
  | { kind: "analog-source";                    // 0–10V の調光出力（§5.17）
      signalTerminal: string; commonTerminal: string
      minVolts: number; maxVolts: number; defaultVolts: number
      fade?: FadeSpec }                         // 持つものがフェードする（§5.18）
```

**`kind` を増やすのは最後の手段。** タイマーは `relay` の `delay`、調光ランプは `lamp` の `dimming`、フェードする調光出力は `analog-source` の `fade` で表しており、既存の振る舞いの設定差では `kind` を増やさない（CLAUDE.md 設計原則 2・7）。一方、`analog-source` は**基準に対する電圧値を出す**、`ac-dc-power-supply` は**入力側と絶縁した別の電源電位を条件付きで生成する**という既存 kind では表せない物理的な振る舞いなので、型番非依存の kind として追加する。

```ts
// フェードの設定範囲（§5.18）。形は TimerDelay の設定時間 3 点とそろえてある
type FadeSpec = {
  minFadeMs: number; maxFadeMs: number
  defaultFadeMs: number    // **0 から始める**（保存済みの回路の挙動を変えない）
}

// V → % の対応。**エンジンに型番分岐を書かないための宣言**（§5.17）
type AnalogCurve = {
  minVolts: number; maxVolts: number
  percentAtMin: number     // 逆特性（この盤の仕様）ではここが 100
  percentAtMax: number     // 同じく、ここが 0
}

type DimmingInput = {
  signalTerminal: string   // 0–10V を受ける端子
  commonTerminal: string   // 信号の基準（0V コモン）。共通でないと信号が成立しない
  curve: AnalogCurve
  unconnectedVolts: number // 信号線が未接続のときに入力段が示すレベル。
                           // **エンジンが決め打ちしない**（実機の入力回路次第）
}
```

#### 通信の面（`ComponentDefinition.communication`・Step 24 で追加）

```ts
type DeviceOperation = {
  id: string
  label: string
  kind?: "switch" | "level"   // 省略は "switch"。"level" がフェーダー（§4.17）
  defaultPercent?: number     // "level" のときの既定値（%）
}

type CommunicationPort = {
  plusTerminal: string        // ＋側（A）
  minusTerminal: string       // −側（B）
  commonTerminals: string[]   // 信号の基準（GND）。**共通でないと成立しない**
}

type CommunicationBinding = {
  signalId: string            // 受け取る値の名前。送り手の DeviceOperation.id と一致させる
  channelId: string           // 割り当て先の調光出力チャンネル
}

type CommunicationDefinition = {
  port: CommunicationPort
  transmits?: string[]              // 送る操作子の ID（操作卓が持つ）
  receives?: CommunicationBinding[] // 受けた値の割り当て（コントローラが持つ）
}
```

**`ElectricalDefinition` の中に入れない。** 通信線が運ぶのは電位ではなく値で、ネットの分割にも `NetState` にも関係が無い（§5.19）。`electrical` の中に置くと、`kind` ごとのユニオンに「通信を持つリレー」「持たないリレー」の枝が生え、電気の判定を読む人が通信の有無を気にすることになる。

**送り手と受け手は `signalId` という名前だけで繋がる。** 定義に相手の型番も相手の端子番号も書かない（CLAUDE.md 設計原則 2）。

#### 未接続でも警告しない端子（`TerminalDefinition.optional`・Step 21 で追加）

**端子が多い機器のための逃げ道。** 46 端子の調光コントローラでは使う端子のほうが少ないのが普通で、未接続をすべて指摘すると**本当に挿し忘れている 1 本が 40 本の雑音に埋もれる**（§5.7）。

立てるのは「使わないことが正常」な端子だけ —— 予備の GND、使わない出力回路、`No Connect` と印字された端子。**繋がないと機器が働かない端子には絶対に立てない。** 調光器の調光信号（CN・GND）は、挿し忘れると（逆特性では）全灯するので対象外にしてある。

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
  noTerminal?: string   // b 接点のみのリレーには存在しない
  ncTerminal?: string   // a 接点のみのリレーには存在しない
  type: "SPDT" | "SPST-NO" | "SPST-NC"
}

type TimerDelay = {                        // §5.13
  mode: "on-delay" | "off-delay"           // 限時動作 / 限時復帰
  defaultPresetMs: number
  minPresetMs: number
  maxPresetMs: number
}
```

**要件書からの変更点:** `polaritySensitive: boolean` を 3 値の `CoilPolarity` に変更した。理由は §5.3 を参照。

**`ncTerminal` / `noTerminal` はどちらも省略可能。** すべてのリレーが c 接点（切替接点）を持つわけではない。ねじ／タブ端子のパワーリレーには **a 接点のみ（`SPST-NO`）** の型番があり、b 接点の端子が**実機に存在しない**。逆に電磁接触器の補助 b 接点（21–22）は **b 接点のみ（`SPST-NC`）** で、対になる a 接点の端子が無い（§4.12）。ここを「無いから空文字」で埋めると、端子一覧にも接点表にも幽霊の行が出て、実端子番号が正しいという前提が崩れる。

**2 つの省略可能な端子は対称に扱うこと。** 一方だけを `undefined` 前提で書くと、b 接点のみの接点が「NO 端子が `undefined` の a 接点」として静かにすり抜ける。実際、`adapter/inspection.ts` で `other === contact.noTerminal` を先に評価すると、**励磁中の b 接点は両辺とも `undefined` で一致してしまい、実機に無い a 接点が閉じている絵になる。**「閉じている相手がいない」を先に弾くこと（Step 19 で発見・`contactor-scenarios.test.ts` が押さえている）。

**接点の駆動源はコイルだけではない（Step 22）。** `RelayContact.trigger`（アナログ量）と `operationId`（人の操作）を持つ接点は、コイルの励磁とは無関係に自分の駆動源を見る。あわせて `coil` を省略可能にした —— カットリレーにも操作卓のボタンにも実機にコイルは無く、無い端子を作って埋めないのは `ncTerminal` と同じ（§4.16）。

**タイマーリレーは `kind: "timer"` を作らず、`kind: "relay"` に `delay?: TimerDelay` を足して表す。** タイマーリレーはリレーであって別種の部品ではない —— コイルも接点も同じものを持ち、違うのは接点が動くタイミングだけ。`kind` を分けると接点・コイル・端子まわりの分岐がエンジンと adapter の各所で 2 本になり、片方だけ直す事故が起きる。この形にしたことで、極性判定（§5.3）・接点の開閉（§5.1）・未接続端子（§5.7）・自己保持の検出（§5.9）・経路説明（§5.11）・接点の図記号（§8.11）は**リレー用のコードがそのまま効く。** `ncTerminal` を省略可能にして a 接点のみのリレーを表したのと同じ拡張の形。

**エンジンが見るのは端子の有無だけで、`type` の文字列は見ない。** `type` は接点の形を人が読むための値（プロパティパネル・`contactSummaryOf()` の "4c" / "2a" / "4a1b" 表示）であって、判定条件ではない。`type: "SPST-NO"` も `"SPST-NC"` も、足したところで `engine/` の分岐は増えず、開閉規則は §5.1 の 1 箇所に閉じたままになる（CLAUDE.md 設計原則 2）。

**その保証は `engine/relay.ts` の 1 行の形にある。** `closedContactPairs()` / `openContactPairs()` はどちらも「その向きの端子を引き、`undefined` なら組を作らない」という同じ 1 行で書かれており、a 接点のみと b 接点のみを**同じコードで**扱う。Step 19（電磁接触器）で `engine/` の差分が 0 行だったのはこの形のおかげ。

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
    presetMs?: number          // タイマーの設定時間（省略 = defaultPresetMs・§5.13）
    lampColor?: LampColor      // 表示ランプのレンズの色（省略 = DEFAULT_LAMP_COLOR・§4.11）
    outputVolts?: number       // 調光出力の電圧（省略 = defaultVolts・§5.17）
    fadeMs?: number            // 調光出力のフェード時間（省略 = defaultFadeMs・§5.18）
  }[]
  connections: CircuitConnection[]
  viewport: { x: number; y: number; zoom: number }
}
```

`terminalKey()` を関数にしてあるのは、キー書式を 1 箇所に閉じるため。各所で `` `${a}:${b}` `` を手書きすると、書式がずれた瞬間にネット引きが静かに失敗する。

**`presetMs` は定義ではなくインスタンスに持つ。** 実機のタイマーはダイヤルで設定するものであり、定義に固定すると「3 秒の T1 と 10 秒の T2」を同じ型番で置けなくなる。追加フィールドなので保存形式は `version: 1` のままで、旧データはそのまま読める（読み込み時に有限数の検証と min/max クランプを行い、壊れていても部品ごと捨てず既定値へ倒す ——`flipped` と同じ扱い）。

**`lampColor` も定義ではなくインスタンスに持つ**（§4.11）。レンズは同じ型番の表示灯に差し替えて使うもので、定義に固定すると色ごとに別の部品を並べることになる。`presetMs` と同じく追加フィールドなので `version: 1` のままで、旧データはそのまま読める（知らない色名は既定へ倒し、ランプ以外に付いていたら落とす）。

**`outputVolts` も定義ではなくインスタンスに持つ**（§5.17）。実機の調光出力はつまみや設定で決めるもので、`presetMs` とまったく同じ扱い（`version: 1` のまま・有限数の検証と min/max クランプ・調光出力以外に付いていたら落とす）。**ただし `flipped` や `lampColor` と違い、これは電気的な意味を持つ** —— エンジンがこの値を読み、繋がった負荷の明るさが変わる。

**`fadeMs` も定義ではなくインスタンスに持つ**（§5.18）。実機のフェード時間は盤ごとに設定するもので、`presetMs` とまったく同じ扱い（`version: 1` のまま・有限数の検証と min/max クランプ・`fade` を持たない部品に付いていたら落とす）。**チャンネルごとに分けない** —— 実機のフェードはシーン全体にかかる設定で、回路ごとの値ではない（電圧は回路ごと・フェードは機器ごと）。`outputVolts` と同じく電気的な意味を持つ。

**`flipped` は見た目だけの属性で、電気的な意味を一切持たない。** 反転しても端子 ID・端子番号・役割は変わらず、`CircuitConnection` も `ElectricalDefinition` もまったく同じものを指す。**エンジンはこのフィールドを読まない**（§8.1）。`ComponentDefinition` 側ではなくインスタンス側に置いてあるのは、同じ型番を反転して並べられる必要があるため。定義は全インスタンスで共有する不変データなので、そこに向きを持たせると 1 個の反転が全部に波及する。

### 3.4 シミュレーション入出力

```ts
type SimulationInput = {
  pressedSwitches: ReadonlySet<string>   // 操作中（押下中／ON 位置）の componentId・§4.7
  operatedDevices?: ReadonlySet<string>  // 倒している機器の操作子 operationKey()・§4.16
  deviceLevels?: ReadonlyMap<string, number>  // フェーダーの位置 operationKey() → %・§4.17
  previousEnergizedRelays?: ReadonlySet<string>  // 直前の励磁状態。収束計算の初期値
  nowMs?: number                         // 開始からの経過ミリ秒（省略 = 0）・§5.13
  previousTimers?: ReadonlyMap<string, TimerState>  // 直前のタイマー状態・§5.13
  previousFades?: ReadonlyMap<string, FadeState>    // 直前のフェード状態・§5.18
}

type SimulationStatus = "stable" | "oscillating" | "not-converged"

type SimulationResult = {
  energizedRelays: ReadonlySet<string>   // **接点が切り替わっている** componentId・§5.13
  litLamps: ReadonlySet<string>
  netOf: ReadonlyMap<string, number>     // terminalKey() → ネットID
  netState: ReadonlyMap<number, NetState>  // ネットID → 電位状態
  warnings: Warning[]
  status: SimulationStatus
  iterations: number
  timers: ReadonlyMap<string, TimerState>  // 次回の previousTimers になる・§5.13
  fades: ReadonlyMap<string, FadeState>    // 次回の previousFades になる・§5.18
  nextEventAtMs?: number                 // 次に結果が変わり終わる時刻。動いていなければ無し
  analog: AnalogResult                   // アナログ層の解（§5.17）。使わない回路では空
  operatedContacts: ReadonlyMap<string, ReadonlySet<string>>  // componentId → 動作中の接点ID・§4.16
}

type AnalogSignal = {                    // §5.17
  volts: number                          // 信号ネットの電圧
  referenceNet: number                   // この電圧の基準となるネットID
  sourceIds: readonly string[]           // 出している調光出力の componentId
  pulledToReference: boolean             // 外部から基準へ落とされている（"DIRECT" 相当）
}

type DimmingLevel = {                    // 調光入力を持つ負荷 1 個の解・§5.17
  volts: number                          // 入力段が見ている電圧（端子に出す）
  percent: number                        // 明るさ 0–100（部品に出す）
  floating: boolean                      // 信号が届かず unconnectedVolts を使った
  referenceMismatch: boolean             // 基準が共通でない＝信号が成立しない
}

type AnalogResult = {
  signalOf: ReadonlyMap<number, AnalogSignal>  // ネットID → 乗っている信号
  levelOf: ReadonlyMap<string, DimmingLevel>   // componentId → 明るさ
}

type TimerState = {                      // §5.13
  coilOn: boolean                        // コイルに電圧がかかっているか（今この瞬間）
  changedAtMs: number | null             // coilOn が今の値になった時刻。null = 開始からずっと
}

type FadeState = {                       // §5.18。キーは fadeKey()（componentId:channelId）
  targetVolts: number                    // channelVolts から決まる目標
  fromVolts: number                      // ランプを開始したときの電圧（「前の目標」ではない）
  changedAtMs: number | null             // 目標が今の値になった時刻。null = 開始からずっと
}

type NetState = {
  reachesPlus: boolean
  reachesZero: boolean
}
```

出力側のコレクションを `Readonly*` にしているのは、UI 側が結果を書き換えてストアと不整合を起こすのを型で防ぐため。エンジン内部では通常の `Set` / `Map` を組み立ててそのまま返してよい。

**`previousEnergizedRelays` を入力に持つ理由（Step 2 で判明）。** 自己保持回路はボタンを離した状態で「全リレー非励磁」と「励磁継続」の**両方が安定解になる双安定回路**であり、どちらに落ちるかは直前の状態でしか決まらない。毎回すべて非励磁から解き直すと、ボタンを離した瞬間に必ず全 OFF 側の解へ落ち、自己保持が原理的に再現できない（検証回路テスト 3・4）。前回の `SimulationResult.energizedRelays` をそのまま渡すことで、UI 側は状態遷移を意識せずに済む。省略時は全リレー非励磁から始める（新規回路・シミュレーション開始時）。

**`nowMs` / `previousTimers` も同じ形で入力に持つ（§5.13）。** 時刻をエンジンが自分で読む（`performance.now()`）と純粋関数でなくなり（CLAUDE.md 設計原則 1）、テストが実時間に縛られる。時計を持つのは `simulationStore` だけで、エンジンは「今が何 ms か」を教えてもらうだけ。`previousTimers` は `previousEnergizedRelays` と同じく**渡し忘れると壊れる** —— 毎回「今この瞬間に入力が入った」ところからやり直すので、オンディレイの接点が永久に動かない。

**`energizedRelays` の意味は「接点が切り替わっている」であって「コイルが励磁している」ではない。** 遅延なしのリレーでは一致するが、タイマーではずれる（オンディレイは設定時間ぶん遅れて接点が入る）。`buildNets()` が見るのは接点の側なので、この定義でないとネットが組めない。タイマーのコイルの状態は `timers` を見る。

**`analog` は `netState` とは別に持つ**（§5.17）。電圧値を `NetState` に混ぜると、0V を出しているだけの調光信号線が電源の 0V と見分けられなくなり、電源短絡の判定にも配線色にも紛れ込む。**アナログ量は導通レイヤに重ねる第 2 パス**であって、導通の答えを 1 ビットも変えない。

**`litLamps` は調光ランプの 0% を「消灯」として扱う。** 電源が来ていても明るさ 0%（この盤の仕様では 10V）なら光っていない。逆に、明るさ 100% でも電源が来ていなければ点かない —— 明るさと点灯は独立した 2 つの軸で、潰すと「消えている理由」が読めなくなる。

`Warning` は §5.7 の 7 種に対応する。

```ts
type WarningCode =
  | "power-short-circuit"       // +24V と 0V が導通
  | "coil-polarity-reversed"    // コイルに逆極性で電圧
  | "diode-reversed"            // ダイオードの向きが逆（§5.4）
  | "unconnected-terminal"      // どの接続にも現れない端子
  | "coil-self-interrupt"       // コイルが自分自身の b 接点で給電を切る（§5.14）
  | "oscillating"               // 励磁状態が振動する
  | "not-converged"             // 反復上限に到達
  | "analog-reference-mismatch" // 調光の基準（0V コモン）が共通でない（§5.17）

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
| 汎用電磁接触器の端子記号（`A1` / `1/L1`〜`6/T3` / `13`-`14` / `21`-`22`） | **未検証**（規格由来） | §4.12。IEC 60947-1（EN 50005）の端子記号で、メーカーを問わず実機に刻印されている。**ただし特定型番のカタログとは未照合**で、極数・補助接点の構成・コイル定格は型番ごとに違うため `verified: false`。汎用部品でありながら `number` を持つ唯一の定義 |
| G7L-1A-B / G7L-2A-B の端子データ | **検証済み** | 別系列なので確度表も分けてある。§4.9 を参照 |

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

### 4.8 OMRON G7L-1A-B / G7L-2A-B DC24V（ねじ端子形パワーリレー）

MY シリーズと違い、**差込みソケットではなくねじ端子に直接配線する 25A 級のパワーリレー**。接点は **a 接点のみ**で、b 接点の端子が実機に存在しない。

**G7L-2A-B（2 極）**

| 接点 | a接点の 2 端子 |
|---|---|
| 第 1 極 | 2 – 4 |
| 第 2 極 | 6 – 8 |

**G7L-1A-B（1 極）**

| 接点 | a接点の 2 端子 |
|---|---|
| 第 1 極 | **4 – 6** |

コイル: **0 と 1**（**極性なし**）

**1 極形の端子番号は 4・6 で、2 と 8 が欠番になる。** 2 極形の 1 行目（2–4）ではない。カタログ p.8 の 1 極形の図では、2 極形でいう**内側 2 本の位置**に 4・6 が振られている。MY2N が 1・4・5・8・9・12 の飛び番を持つのと同じ性質で、**4–6 を 2–4 に詰め直してはならない**（requirements.md US-F）。

#### COM は無い

G7L の接点はダブルブレークの a 接点で、**2 端子は対等**。どちらが入力でどちらが出力という決まりはカタログのどこにも書かれていない。したがって端子の `role` は **両方とも `normally_open`** にし、COM を名乗らせない。

`RelayContact` は c 接点を基準にした形（`commonTerminal` / `noTerminal`）をしているため、若い番号を `commonTerminal` に置いている。**これは並びを決めるための規約でしかなく、実機に COM があるという意味ではない。** エンジンはこの 2 端子を励磁中だけ union するので、どちらに置いても挙動は変わらない。

プロパティパネルも呼称を合わせる。NC 端子を持たない接点では **「COM–NO」ではなく「a接点」**、**「第1接点」ではなくカタログの数え方に合わせて「第1極」**と出す（§8.3）。

#### コイルに極性が無い

カタログ p.8 の各図に「（コイル極性はありません）」と明記があり、p.12 のコイル内部接続図でも**直流操作コイルは 0–1 間が素のコイル記号だけ**（ダイオードも表示 LED も無い）。よって `polarity: "none"`。

MY2N / MY4N も `none` だが理由が違う。MY は**逆並列 LED があるから**逆接でも点灯するという話で、G7L は**そもそもコイル以外に何も入っていない**。`RelayDefinition.coil` の `positiveTerminal` / `negativeTerminal` には形式上 0 / 1 を割り当てているが、`polarity: "none"` なのでどちら向きでも励磁する（§5.3）。

端子の役割には `coil_positive` / `coil_negative` ではなく **`coil`**（§3.1）を使う。`coil_positive` を当てると、画面が実機に無い極性を主張してしまう。

#### 定義の共有は MY シリーズと分ける

端子番号の振り方が別系列なので、`omron/my-series.ts` の表は共有せず `omron/g7l-series.ts` を立てた（§4.3.1 の但し書きどおり）。1 極形と 2 極形の差は `defineG7lRelay()` に渡す**接点行が 1 行か 2 行かだけ**で、コイル・極性・定格・出典はすべて共通。

| 型番 | 接点行 | 端子 | `visual` |
|---|---|---|---|
| G7L-1A-B | 4–6（1 行） | 0・1・4・6 | 200×200 |
| G7L-2A-B | 2–4 / 6–8（2 行） | 0・1・2・4・6・8 | 240×200 |

**画面上の端子配置。** 実機のねじ端子の並び（コイルが上辺・接点が下辺）は模さず、**MY シリーズと同じ「コイルは左辺」で揃える**。パレットにリレーが並んだとき型番ごとにコイルの位置が変わると、制御回路をどちら側へ描くかが型番次第になってしまう。接点は 1 極ぶんを上下 1 組（若い番号が上・大きい番号が下）にし、横位置は端子番号ではなく**何極中の何番目か**から決める（§4.1 の `spread()` と同じ）。

| 辺 | 端子 |
|---|---|
| 上 | 各極の若い方（2 極なら 2・6 / 1 極なら 4） |
| 下 | 各極の大きい方（2 極なら 4・8 / 1 極なら 6） |
| 左 | コイル 0・1 |

#### エンジンへの影響

**型番分岐は 1 つも増えていない。** ただし Step 7 の 4 部品と違い、**差分 0 行では収まらなかった**。a 接点のみという接点の形は既存の型で表現できず、`RelayContact.ncTerminal` を省略可能にする必要があった（§3.2）。その 1 点だけで `closedContactPairs()` の挙動が正しくなり、判定条件は「相手の端子が定義にあるか」に閉じている（§5.1）。

### 4.9 G7L のデータの確度と検証状態

端子データは **オムロン公式カタログ（カタログ番号 CDPA-041C・2025 年 4 月現在）と照合済み**。`source` はこのカタログを指す。

| 項目 | 確度 | 根拠 |
|---|---|---|
| G7L-2A-B 接点 2–4 / 6–8 | **検証済み** | p.8「端子配置/内部接続図（TOP VIEW）」。E 金具取りつけ形とアダプタ取りつけ形の**2 枚の図が同じ番号**を振っている |
| G7L-1A-B 接点 4–6（2・8 が欠番） | **検証済み** | 同 p.8 の 1 極形の図。テストボタン付き（-BJ）の図も同じ 4・6 |
| コイル 0 / 1 | **検証済み** | 同 p.8 の各図。p.12「コイル内部接続図」の直流操作コイルも 0–1 |
| コイルに極性なし | **検証済み** | p.8 の各図に「（コイル極性はありません）」と明記。p.12 の直流操作コイルは素のコイル記号のみで、ダイオードも LED も無い |
| 接点構成が a 接点のみ | **検証済み** | p.1「形式基準」②接点構成 `A：a接点`、および p.1「構成」表の `1a` / `2a` |
| コイル DC24V の定格 | **検証済み** | p.3「定格・操作コイル」。定格電流 79mA / コイル抵抗 303Ω / 消費電力 約 1.9W |

**検証したのはねじ端子形（-B）の図だけ。** 同じ G7L でもタブ端子形（-T）・プリント基板端子形（-P）は p.6・p.10 に**別の図**が載っている。端子形状違いや取りつけ違い（-UB / -J）へ定義を流用するときは、`verified` を引き継がず該当ページの図を引き直すこと（CLAUDE.md 設計原則 5）。

出典に**カタログ番号と図の位置（p.8）を残す**のは、再検証できる状態を保つため。「オムロンのどこか」まで薄まると、番号が合っているかを後から誰も確かめられない。`registry.test.ts` がこの 2 つの文字列の存在を押さえている。

参考にした資料:
- **オムロン制御機器「G7L パワーリレー」カタログ CDPA-041C（端子データの出典）**
- [G7L パワーリレー — オムロン制御機器](https://www.fa.omron.co.jp/products/family/2837/)

### 4.10 汎用タイマー（`definitions/timers.ts`）

実型番を持たない汎用部品。端子は 5 個で、限時動作（オンディレイ）と限時復帰（オフディレイ）で構成は同じ。

| 端子 | 役割 | 説明 |
|---|---|---|
| 1 | `coil` | 入力（コイル） |
| 2 | `coil` | 入力（コイル） |
| 3 | `common` | 限時接点 COM |
| 4 | `normally_open` | 限時 a 接点 |
| 5 | `normally_closed` | 限時 b 接点 |

| 項目 | 値 |
|---|---|
| 設定時間の既定値 | 3.0 秒 |
| 設定できる範囲 | 0.1 秒 〜 10 分（`100ms` 〜 `600000ms`） |
| コイルの極性 | `none`（汎用部品に実機に無い極性を主張しない・§4.8 と同じ判断） |
| `verified` | `false`（実端子番号ではないので検証対象が存在しない・§4.5 と同じ） |

**実型番（OMRON H3Y-2 など）はまだ入れていない。** 実端子番号を主張するには公式データシートの図を自分で確認する工程が要る（CLAUDE.md 設計原則 5）。足すときは `verified: false` から始める。**汎用タイマーの端子表を流用しない** —— ソケット形の実機はピン配置がまったく違う。

---

### 4.11 表示ランプのレンズの色（`CircuitComponentInstance.lampColor`・Step 17 で確定）

**盤面では色そのものが意味を持つ。** 赤＝異常・緑＝運転・黄＝警報という対応は制御盤の慣習で、図面で描き分けられないとその意味が消える。**電気的な意味は一切持たない**（`flipped` と同じ・エンジンはこのフィールドを読まない）。

#### 定義ではなくインスタンスに持つ

レンズは同じ型番の表示灯に差し替えて使うもの。定義に固定すると「赤の DC24V 表示ランプ」「緑の DC24V 表示ランプ」を別部品としてパレットに並べることになり、**型番が増えていないのに部品が増える。** タイマーの `presetMs` と同じ判断（§5.13）。

| | 値 |
|---|---|
| 選べる色 | 黄 / 赤 / 緑 / 青 / 白（`LAMP_COLORS`） |
| 既定 | **黄**（`DEFAULT_LAMP_COLOR`） |
| 保存 | 既定色は**持たない形**に戻す（`flipped` と同じ）。保存 JSON に「既定と同じ値」を残すと、既定を変えたときに古い回路だけ取り残される |

**既定を黄にしてあるのは、この機能が入る前の `--lamp-on`（琥珀 `#fbbf24`）と同じ値だから。** 色を選んでいない既存の回路は 1px も見た目が変わらない。

#### 消灯中も色を出す

▶ を押すまで何色のランプか分からないのでは、図面として使えない。**消灯は同じ色相の淡い塗り、点灯は濃い塗り＋縁＋光芒**で分ける。

見分けが**色相ではなく明度と光芒に乗っている**ので、色覚に依存しない（要件書 §8）。点灯時は縁を 2px に太らせて、塗り以外にも合図を乗せる。

**白だけは光芒の色を塗りから外す**（暖色 `#facc15`）。白い本体の上に白く光らせても何も起きていないのと同じに見え、点灯が読めない。実機の白色表示灯も電球色に灯るので、図としても嘘にならない。

#### 履歴は 1 手

`setComponentLampColor` は Undo の対象にする。色は図の意味そのものなので、押し間違いを戻せないと図面の意味が変わったままになる（ラベルの変更が履歴を持たないのとは事情が違う・§7）。ランプ以外の部品には書き込まない —— 誰も読まない値を保存 JSON に残さない。

### 4.12 汎用電磁接触器（`definitions/contactors.ts`・Step 19 で確定）

実型番を持たない汎用部品。**主接点 3 極 ＋ 補助 1a1b ＋ AC100V コイル**の 12 端子。

| 端子 | 役割 |
|---|---|
| `1/L1` – `2/T1` / `3/L2` – `4/T2` / `5/L3` – `6/T3` | 主接点 3 極（a 接点）。奇数が電源側、偶数が負荷側 |
| `13` – `14` | 補助 a 接点 |
| `21` – `22` | 補助 b 接点。**対になる a 接点の端子は実機に無い** |
| `A1` / `A2` | 操作コイル AC100V。**極性なし** |

#### 電気的にはリレー。`kind` を分けない

電磁接触器はコイルで接点を動かす部品であり、リレーと別種ではない。タイマーを `kind: "timer"` にしなかったのと同じ理由で（§5.13・CLAUDE.md 設計原則 7）、`kind: "relay"` のまま `contacts[]` の中身だけで表す。極性判定・接点の開閉・未接続端子の検出・自己保持の検出・経路説明・接点の図記号は、**リレー用のコードがそのまま効く。**

**`category` も `"relay"` のまま。** パレットの見出しを増やしていないのは、電磁接触器がリレーの一種として並んで困らないため。タイマーだけ `category: "timer"` を持つのは図記号を出し分けるためで、接触器はリレーと同じ接点の図記号でよい。

#### 補助 b 接点は「NO 端子が無い接点」

本節でいちばん効いた 1 点。G7L が `ncTerminal` を省いて a 接点のみを表したのと**左右対称**に、21–22 は `noTerminal` を省いて表す（§3.2）。非励磁で 21–22 が閉じ、励磁すると **21 はどこにも繋がらない。**

ここを c 接点の「COM は必ずどちらかへ倒れる」で埋めると、**実機に無い a 接点が生える。** `SPST-NO` のときと同じ落とし穴が、向きだけ変わって現れる。

#### 端子記号は IEC を採る —— 押しボタンとは判断が逆

`switches.ts` は IEC 慣例の 13-14 / 11-12 を**採らなかった**。汎用の押しボタンに標準の端子記号は無く、13 / 14 は MY4N のコイルと紛らわしいため（§4.5）。

電磁接触器は事情が逆で、**`A1` / `A2`・`1/L1`〜`6/T3`・`13`-`14`・`21`-`22` は IEC 60947-1（EN 50005）で決まっており、メーカーを問わず実機に刻印されている。** ここで独自の番号を振ると実機と違う記号を教えることになり、MY2N の飛び番を詰め直さないのと同じ理由で避ける。したがって `number` を持たせる —— 汎用部品でありながら実端子記号を持つ、初めての定義になる。

**ただし `verified: false`。** IEC の記号ではあるが特定型番のカタログとは照合していない。極数・補助接点の構成・コイル定格は型番ごとに違う（CLAUDE.md 設計原則 5）。

#### 接点構成の表示は形ごとに数える

`contactSummaryOf()` は主接点 3 極 ＋ 補助 a を `SPST-NO`、補助 b を `SPST-NC` と数えて **"4a1b"** を返す。これを "5c" と丸めると**実機に無い切替接点を 5 回路ぶん主張する**ことになる。

#### エンジンへの影響

**無い。** `engine/` の差分は 0 行（`contactor-scenarios.test.ts` が動作を押さえている）。手を入れたのは型（`RelayContact`）と、`undefined` を扱う adapter / UI の 4 箇所だけ。Step 7・Step 17 と同じデータ駆動の検証を兼ねる。

### 4.13 AC 電源（`definitions/power.ts`・Step 19 で確定）

AC100V 電源。端子は `L`（非接地側）/ `N`（接地側）で、実端子番号ではないため `number` は持たない。

#### 直流と交流で型の形は分けない

どちらも `kind: "power"` の `currentType` 違い。**エンジンは `currentType` を一度も読まない**（`src/circuit/engine/` に 1 度も出現しない）。判定は交流でも「**同じ 1 台の電源**の両端に届くか」のままで、L–N 直結が電源短絡になるのも、別の電源の N をまたいだ負荷が通電しないのも、§5.3 の同じ規則から出る。

#### 分かれるのは端子の役割だけ

`TerminalRole` に `power_line` / `power_neutral` を足した。**`power_positive` / `power_zero` を流用しない** —— 交流に + と 0V は無く、画面が「電源 +」と書いた時点で直流と同じものだと読ませてしまう。G7L で極性なしコイル用に `coil` を足したのと同じ 1 語の追加（§4.8）。

### 4.14 調光（`definitions/dimming.ts`・Step 20 で確定）

いずれも実型番を持たない汎用部品。端子の呼称は本アプリの便宜的なもので、実端子番号ではない（§4.5 の定型文）。

| 定義 | 端子 | 役割 |
|---|---|---|
| 汎用 0–10V 調光出力（`dimmer-0-10v`） | `V+` | `analog_signal`（調光信号 0–10V） |
| | `COM` | `analog_common`（信号の基準・0V コモン） |
| AC100V 調光ランプ（`lamp-dimmable-ac100v`） | `1` / `2` | `generic`（電源・極性なし） |
| | `DIM+` | `analog_signal` |
| | `DIM−` | `analog_common` |

#### 逆特性はここが持つ

**この盤の調光仕様は 0V = 100% / 10V = 0%。** 一般的な 0–10V 機器（0V = 消灯）と真逆で、この向きだからこそ「調光信号線を挿し忘れると、消えるのではなく全灯する」という気付きにくい失敗が起きる。

対応は `AnalogCurve`（`percentAtMin: 100` / `percentAtMax: 0`）という**定義側の宣言**で持つ。`if (model === "FMD-701D") invert` と書けば設計原則 2 が崩れるうえ、順特性の機器を足すたびにエンジンが分岐で埋まる。宣言にしてあるので、順特性の機器は 2 つの値を入れ替えるだけで足りる（`engine/analog.ts` は 1 行も変わらない）。

#### 未接続時のレベルも定義が持つ

`unconnectedVolts: 0`（＝この曲線では 100%）。プルアップかプルダウンかは**実機の入力回路次第**で、エンジンに焼き込むと順特性の機器で嘘になる。`unconnected-terminal` の警告文はこの値をそのまま読む（§5.7）。

#### コモンの役割に `power_zero` を流用しない

実際の盤ではコモンを電源の 0V へ繋ぐが、それは**配線の話であって端子の役割ではない。** ここを `power_zero` と書くと、繋いでいなくても電源の 0V がそこにあるかのように画面が主張し、「GND を共通にしていない」という最も捕まえたい誤配線が読めなくなる（§5.17）。

#### 既定の出力は 5V（＝50%）

置いた直後の姿を、**未接続時（0V ＝ 100%）とも DIRECT（0V ＝ 100%）とも違うレベル**にするため。既定が 0V だと繋いでも繋がなくても全灯で、配線が効いているかどうかが画面から読めない。

#### フェードは持つが既定は 0 秒

`fade: { minFadeMs: 0, maxFadeMs: 60_000, defaultFadeMs: 0 }`（§5.18）。上限 60 秒は実機のシーンフェードで使う範囲を覆う値。**既定を 0（フェードしない）にしてあるので、置いた直後の挙動はフェードが入る前とまったく同じ** —— 保存済みの回路を開いた瞬間に動きが変わらない。プロパティパネルで秒を入れて初めてフェードする。

#### 実型番（FMD-701D）はまだ無い

社内オリジナル製品で公開データシートが存在せず、実端子記号を主張するには社内図面の図番・版数・確認日を `source` に残す工程が要る（CLAUDE.md 設計原則 5。社内製品は改訂されるので外部品より重要）。接点入力がどのチャンネルを何 V にするか・DIRECT / CUT が信号線に何をするかも未確定で、本スコープは汎用部品で閉じている。

`ElectricalDefinition` 側は `positiveTerminal` / `zeroTerminal` というフィールド名のままで、L / N を割り当てている。**これは型の形に合わせた割り当てにすぎない** —— L が「+ 側」という意味ではない（G7L のコイル端子と同じ扱い）。

#### 交流として扱わないこと

位相・実効値・極性の反転・力率は再現しない。**定格電圧の不一致も検出しない** —— AC100V の回路に DC24V のランプを繋いでも警告は出ない（§6-3 のまま）。交流であることは今のところ**端子の呼称と表示だけ**の情報で、判定には一切効かない。

### 4.15 実機の調光システムの機器（`definitions/lighting-system.ts`・Step 21 で確定）

社内の仕様書が読めるようになったので、盤に実際に載っている機器の形へ寄せた。

**型番・製造元・製品名は書かない。** 公開できるのは挙動と端子番号だけ（ユーザー判断）。呼び名は汎用にし、**端子番号だけを実機どおりにする** —— 実端子番号を扱えることが本プロダクトの価値なので、そこを伏せると足す意味が無くなる。

#### 調光コントローラ（0–10V 16 回路・46 端子）

| 端子 | 役割 |
|---|---|
| 1–8 | フェーダー調光信号出力（0–10V） |
| 9–16 | 照明スイッチ調光信号出力（0–10V） |
| 17–20 | 未接続（No Connect） |
| 21 / 44 / 45 / 46 | GND（**機器の中で繋がっている**） |
| 22 / 23 | 通信線 ＋ / − |
| 24–39 | ON/OFF 出力（オープンコレクタ） |
| 40 / 41 | 還流ダイオード |
| 42 / 43 | フォトカプラ入力 ＋ / − |

**GND だけは union する。** 信号端子とコモンを union しない原則（§5.17）は保ったまま、`conductingPairs()` が `commonTerminals` どうしを鎖で繋ぐ。ここを繋がないと、**GND 21 に繋いだ機器と GND 45 に繋いだ機器が「基準が共通でない」と出て、正しい配線が成立しなくなる。**

**ON/OFF 出力（24–39）は端子として出すだけ。** オープンコレクタは「動作したら GND へ落とす」接点で、駆動源（シーン記憶・フェーダー割付）は機器 1 台では決まらない（§4.16）。

**通信線（22・23）は Step 24 で繋がった。** 端子を出しただけだった状態から、操作卓が送る `fader1`–`8` → `ch1`–`8`、`light1`–`8` → `ch9`–`16` の割り当て（`communication.receives`）を持つようになり、フェーダーを上げると 1–16 の出力電圧が動く（§4.17・§5.19）。**Step 21 で書いた「電位がどこまで届くかで判定するエンジンでは通信の中身に意味が出ない」は、通信をその判定に載せないことで解いた** —— 通信は導通レイヤに参加せず、組み終わったネットの上を第 2 パスで走る。

**既定の出力は 10V。** 仕様書の「消灯時 10V、点灯時 0V」に合わせてある。0V を既定にすると、置いた瞬間に全 16 回路が全灯して、どの回路を操作したのかが画面から読めない。

**フェードも持つが既定は 0 秒**（§5.18・`fade: { minFadeMs: 0, maxFadeMs: 60_000, defaultFadeMs: 0 }`）。実機のフェード時間は盤ごとに設定するもので、仕様書から特定の秒数を読み取れていない以上、定義に焼き付けない。**16 回路で 1 つの設定**にしてあるのは、実機のフェードがシーン全体にかかるため（電圧は回路ごと・フェードは機器ごと）。

#### 位相制御調光器（IN / COM / OUT ＋ CN / GND / OFF）

**自分は点らない。通した先を暗くする通り道。** だから `litLamps` にも入らず、両端の電位差も見ない。明るさは部品ではなく**出力回路のネット**に乗る（`AnalogResult.netLevelOf`）—— その回路に繋いだランプが何個あっても同じ 1 つの明るさで点る（実機どおり）。

**AC は通すが union しない。** 入力と出力を同じネットにすると、**同じ電源から取った 2 台の調光器の出力回路まで 1 つに融合し、片方を絞るともう片方まで暗くなる。** ダイオードと同じく「ネットは分けたまま電位だけ流す」形にした（`collectDimmerEdges()`・§5.4）。ダイオードと違うのは**両方向に流す**こと —— 交流の通り道は一方通行ではない。

**遮断（OFF を GND へ落とす）と DIRECT は導通ではなくレベルで表す。** 出力段を開くモデルにすると、アナログ量が接点（ネットの形）を動かすことになり、収束ループ（§5.5）へ入り込む。「アナログは第 2 パス」という前提が崩れる。

遮断が最優先で、DIRECT でも戻らない。実機の強制出力遮断は調光段より後ろで切っているため。

#### 盤ごとの設定は定義に焼き付けない（`DimmerSettings`）

極性・調光上限（100/90/80/70%）・調光下限（0〜50%）・カーブの形（リニヤー / 2 乗特性）・DIRECT は、実機では **DIP スイッチと可変抵抗**で決める。だから定義ではなく**インスタンス**が持つ（タイマーの `presetMs`・ランプの `lampColor` と同じ考え方）。

**とくに極性を定義へ固定してはいけない。** 仕様書を読むと 3 機種とも極性が切替式で、**0V = 100% は「この盤の設定」であって機器の仕様ではない。** ここを `AnalogCurve` に焼き付けると、順特性で使っている同じ機器を置けなくなる。

当てる順は **形 → 上下限 → DIRECT**。DIRECT を最後に置くのは、実機の直点が上限設定すら飛び越えて全点灯するため —— 先に丸めると「DIRECT にしたのに 70% までしか上がらない」という嘘になる。

#### 端子データの確度

| 項目 | 確度 | 根拠 |
|---|---|---|
| 調光コントローラの端子 1–46 | **検証済み** | 社内仕様書（ver.1.1・平成20年3月21日作成）の端子番号表 |
| 調光器の IN/COM/OUT・CN/GND/OFF | **検証済み** | 社内仕様書（17/05/06 作成）の接続図と仕様表 |
| 「消灯時 10V、点灯時 0V」 | **検証済み** | 同仕様書の調整手順に明記 |

**型番を伏せたぶん、`source` には資料の版と日付を残す。** 名前を伏せたせいで後から再検証できなくなるのを防ぐ（CLAUDE.md 設計原則 5 の趣旨）。社内資料は改訂されるので、外部品よりむしろ版を残す必要が強い。`lighting-system.test.ts` が「型番が漏れていないこと」と「出典に版が残っていること」の両方を押さえている。

### 4.16 接点の駆動源を広げる（`definitions/lighting-system.ts`・Step 22 で確定）

**接点はコイルだけで動くものではない。** 実機には 3 通りある。

| 駆動源 | 例 | 表し方 |
|---|---|---|
| コイル | リレー・電磁接触器・タイマー | `RelayDefinition.coil` |
| **アナログ量** | カットリレー | `RelayContact.trigger` |
| **人の操作** | 操作卓のボタン、連動するオープンコレクタ出力 | `RelayContact.operationId` |

`RelayDefinition` は接点・端子・図記号・経路説明・ラダー図をすでに持っているので、**駆動源だけを広げれば残りは全部そのまま効く。** `ncTerminal` / `noTerminal` を省略可能にして接点の形を広げたのと同じ拡張の仕方（§3.2）。

#### `coil` を省略可能にした

カットリレーにも操作卓のボタンにも実機にコイルは無い。**無いコイル端子を作って埋めない**（CLAUDE.md 設計原則 6・`ncTerminal` を空文字で埋めないのと同じ）。省略すると、コイルの極性違反もコイルの未接続も出なくなる —— 存在しないものは検査しない。ラダー図の出力にもならず、自己保持の対象にもならない。

#### 駆動源の判定は 1 箇所（`engine/relay.ts` の `contactOperated()`）

`closedContactPairs()` と `openContactPairs()` が同じ規則を 2 度書くと片方だけ直す事故が起きる（§5.1 と同じ理由）。駆動源を持つ接点は `operatedContacts` を見て、持たない接点だけが従来どおりコイルに従う。

**`energizedRelays` と `operatedContacts` を分けて持つ。** あちらは機器 1 台まるごとの話で、こちらは接点ごと —— 1 台のライトコントローラの中で回路 1 のカットリレーだけが動作している、という状態が普通にある。

#### アナログ量は % で見る

`AnalogTrigger` が持つのは電圧ではなく**明るさ（%）**。実機の「0〜50% で動作」という表記がそのまま設定になる。V で持つと、極性を反転した盤で動作点が裏返り、同じ「30% で動作」が別の意味になってしまう。

動作点は実機の CUT ADJ.（回路ごとのつまみ）にあたるので、定義ではなくインスタンスの `triggerPercents` が持つ（`presetMs` と同じ考え方）。

#### 操作の状態は保存しない

人が倒した状態は `SimulationInput.operatedDevices` で受け、`CircuitDocument` には持たない。**オルタネートスイッチと同じ扱い**で、■ で停止すると OFF 位置へ戻る（§4.7）。盤の状態は配線ではないので、保存対象にすると「保存した回路を開くと勝手に照明が点いている」ことになる。

#### パレットは「探す場所」で分ける

ライトコントローラは電気的にリレー（`kind: "relay"`）、調光操作卓は人が倒すものだが、**どちらも `category` は `dimmer`**。パレットは電気的な分類ではなく探す場所で、MY4N を探している人のリレー一覧に調光の機器が混ざると、リレー回路だけを組みたい人の邪魔になる。

`category` は表示都合だけ（§3.1）なので、エンジンから見た扱いは何も変わらない —— タイマーが `kind: "relay"` のまま `category: "timer"` を持つのと同じ。

#### ライトコントローラ（4 回路・カットリレー）

| 端子 | 役割 |
|---|---|
| INPUT `1`–`4` / `G` | 調光信号入力（0–10V）とその基準 |
| CUT RELAY `1`–`4` / `G` | カットリレー接点（a 接点のみ）とコモン |
| 出力 `1`–`4` | PWM 出力（**波形は扱わない**・§6） |
| `24V` / `GND` | 電源 DC24V |

#### 調光操作卓（15 端子）

端子として意味を持つのは電源の状態に連動する接点で、2 種類ある。

- **無電圧接点**（4-5-6）… COM が NC / NO のどちらかへ倒れる c 接点
- **オープンコレクタ出力**（2・3）… 動作すると GND へ落ちる。**GND（9）をコモンにした c 接点**として表す —— 実機で落とす先が GND なのだから、コモンに GND を置くのがいちばん実機に近い

8 フェーダー・8 シーン記憶は持つが、**このシミュレーターが扱うのは端子に出てくるものだけ**（§6）。

#### 調光コントローラの ON/OFF 出力（24–39）はまだ繋いでいない

16 回路それぞれの駆動源（シーン記憶・フェーダー割付）は操作卓の内部ロジックで、機器 1 台では決まらない。端子は出したままにしてある。

### 4.17 操作卓の通信でコントローラの出力を動かす（Step 24 で確定）

Step 22 までの操作卓は、**倒しても自分の接点しか動かなかった。** 実機で操作卓のフェーダーを上げると調光コントローラの 0–10V が動くのに、シミュレーターでは通信線を繋いでも繋がなくても出力は変わらない —— 「配線図としては描けるが、動かして確かめられない」状態だった。

#### 通信が運ぶのは電位ではなく値

| | 導通（§5.1） | アナログ（§5.17） | 通信（§5.19） |
|---|---|---|---|
| 運ぶもの | 電位の到達 | 電圧（V） | **名前と値（%）** |
| ネットの分割 | 決める | 触れない | 触れない |
| `NetState` | 決める | 触れない | 触れない |

**3 層目を足したのではなく、2 層目と同じ場所にもう 1 パス重ねた。** `resolveCommunication()` は組み終わったネットを読んで「どのポートとどのポートが繋がっているか」を判定するだけで、DSU にも `NetState` にも書き込まない。負荷を union しない原則（§5.2）にも、アナログを導通に混ぜない原則（CLAUDE.md 設計原則 9）にも触れていない。

#### 送り手と受け手は名前で繋がる

```
操作卓 fader1 ──┐
                 │ signalId: "fader1"
調光コントローラ  ┴→ channelId: "ch1" → 0–10V 出力
```

定義に相手の型番を書かない（CLAUDE.md 設計原則 2）。操作卓は「`fader1` を 70% で送っている」としか言わず、コントローラは「`fader1` を受けたら `ch1` へ」としか言わない。別の操作卓を足しても、コントローラの定義は 1 行も変わらない。

#### % で運び、V にするのは受け手

通信線に乗るのは **0–100%**。V への変換は受け手の `analog-source.outputCurve` とインスタンスの極性設定（`dimmerSettings`）が持つ。

**この順番でないと極性の設定が効かない。** 操作卓側で V に直してしまうと、コントローラの DIP を反転させてもフェーダーの効き方が変わらない —— 実機ではコントローラ側の設定なのだから、変換もコントローラ側で起きなければならない。

逆変換（`voltsForPercent()`）は `analogPercent()` の逆関数として `engine/analog.ts` に置いた。**カーブの読み方を 2 箇所に書かない**ため（`closedContactPairs` と `openContactPairs` を 1 箇所にまとめたのと同じ理由・§4.16）。

#### 操作子は入り切りと連続量の 2 種類

`DeviceOperation.kind` を足した（§3.1）。省略は `"switch"` なので、**Step 22 までの定義は 1 行も変わらない。**

| `kind` | 実機 | 動かすもの | 送る値 |
|---|---|---|---|
| `"switch"`（既定） | 電源ボタン・照明スイッチ | 接点（`operationId`） | 倒していれば 100 / いなければ 0 |
| `"level"` | フェーダー | **接点は動かさない** | 位置そのもの（0–100） |

**別の型に分けなかった。** どちらも「人が倒す盤の状態」で、保存しない・停止すると戻る（§4.7）という扱いも同じ。分けると `SimulationInput` も store も UI も 2 本になり、片方だけ直す事故が起きる（CLAUDE.md 設計原則 7 と同じ形）。

フェーダーの位置は `SimulationInput.deviceLevels`（`componentId:operationId` → %）で受ける。`operatedDevices` と同じく**保存しない。**

#### 既定は 0%（消灯側）

この盤は 0V = 100% の逆特性なので、**フェーダーの既定を 100% にすると置いた瞬間に全部点く。** `defaultPercent: 0` から始めて、上げたぶんだけ明るくなる。

#### 通信線を繋いでいないときは何も送らない

送らないので、コントローラは自分の設定値（`channelVolts`）をそのまま出す。**「通信が切れたら消灯」にしない** —— 実機のコントローラは最後に受けた値を保持するもので、通信線を抜いた瞬間に劇場が暗転する仕様のほうが危険。

繋ぎかけの配線は警告で出す（§5.19）。

#### 送るのはフェーダーと照明スイッチだけ

電源ボタンは送らない。こちらは自分の無電圧接点（4-5-6）とオープンコレクタ出力（2・3）を動かすもので、コントローラ側の割り当て（端子 32・38・39）は別の話。コントローラの ON/OFF 出力（24–39）を繋ぐのは引き続きスコープ外（§4.16）。

---


### 4.18 OMRON S8VM-05024（AC-DC スイッチング電源）

OMRON 公式 S8VM 資料で照合した実型番。50W / DC24V 2.2A、定格入力 AC100〜240V、使用可能範囲 AC85〜265V。端子は実機表示どおり `L` / `N` / `FG` / `-V` / `+V` を持ち、これらの刻印を `TerminalDefinition.number` にそのまま保持する。

`ElectricalDefinition.kind = "ac-dc-power-supply"` は型番固有の分岐ではなく、同種 AC-DC 電源が共有する振る舞い。一次側 L/N と二次側 -V/+V は union せず、同じ AC 電源の両極が L/N に届いたときだけ二次側へその電源自身の DC 電位を生成する。入力電圧範囲は仕様情報として保持するが、§4.13 の既存方針どおり定格電圧不一致の判定には使わない。FG は実端子として表示するが、保護接地系そのものは現行シミュレータの電位計算対象外。

## 5. シミュレーションエンジン

### 5.1 中核となる考え方

すべての導通要素を**端子ノードの無向グラフ**として扱い、Union-Find（DSU）で連結成分＝「ネット」を求める。

**union する（導通する）もの:**

- 配線（`CircuitConnection`）
- 端子台の全端子どうし
- CLOSED 状態のスイッチの 2 端子
- CLOSED 状態のリレー接点（非励磁なら COM–NC、励磁なら COM–NO）

**接点の開閉規則はこの 1 箇所（`engine/relay.ts` の `closedContactPairs()`）にしか無い。** 実装は「励磁なら `noTerminal`、非励磁なら `ncTerminal` を COM の相手にする。**相手の端子が定義に無ければペアを出さない**」の 1 行に集約している。

この最後の 1 句が a 接点のみ（`SPST-NO`）のリレーを支えている。b 接点の端子が実機に無いので、非励磁では閉じるペアが 1 つも無く、COM はどこにも繋がらない。ここを「COM は必ずどちらかへ倒れる」と書くと、存在しない端子どうしを union して実機に無い経路を作ってしまう。検証は `engine/__tests__/relay.test.ts`。

**同じ 1 句が b 接点のみ（`SPST-NC`）も支えている。** 電磁接触器の補助 b 接点（21–22）は a 接点の端子が無いので、**励磁すると**閉じるペアが無くなる（§4.12）。向きが逆なだけで規則は同じ —— だから Step 19 で接触器を足したときも `engine/` の差分は 0 行で済んだ。検証は `definitions/__tests__/contactor-scenarios.test.ts`。

プロパティパネル側の `ClosedSide`（§8.3）にも `"open"` がある。**「停止中（`undefined`）」「非励磁で開いている（`"open"`）」「NC 側で閉じている（`"nc"`）」は別物**で、a 接点のみのリレーが取るのは前 2 者だけ。`adapter/inspection.ts` はこの区別をエンジンの答え（COM の相手が誰か）から引き直しており、`energized ? "no" : "nc"` と書き直さない。

**引き直すときは「相手がいない」を最初に弾くこと。** 励磁中の b 接点は相手が `undefined` で、`noTerminal` も `undefined`。`other === contact.noTerminal` を先に評価すると**両辺が一致して `"no"`（a 接点が閉じている）に化ける**（§3.2）。

**union しない（導通しないもの）:**

- リレーコイルの 2 端子
- ランプの 2 端子
- ダイオードの 2 端子（導通はするが union はしない。有向なので §5.4 の電位伝搬で表す）

### 5.2 なぜ負荷を union してはいけないか

コイルやランプを導線として union すると、`+24V → コイル → 0V` を組んだ時点で +24V 端子と 0V 端子が同一ネットになり、電源短絡の誤検出が発生する。負荷は「両端が異なる電源ネットに属するか」で判定する対象であって、導通経路ではない。**これは本エンジン最大の落とし穴なので、実装時に必ずコメントを残すこと。**

### 5.3 コイル励磁の判定

```ts
// 「+ 側に届く電源」から、そのネットで短絡している電源を除いたもの
const plus = (t: string) => netState(t).plusFrom.difference(netState(t).zeroFrom)
const zero = (t: string) => netState(t).zeroFrom.difference(netState(t).plusFrom)

const p = coil.positiveTerminal, n = coil.negativeTerminal
// **同じ 1 台の電源**の + と 0V に届いていること
const forward = plus(p).intersects(zero(n))
const reverse = zero(p).intersects(plus(n))

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

#### ネットの電位は「どの電源に届くか」で持つ

`NetState` は真偽値 2 個ではなく、**電源のインスタンス ID の集合 2 本**（`plusFrom` / `zeroFrom`）で持つ。

**2 ビットに潰すと「PS1 の +24V」と「PS2 の 0V」が区別できない。** 基準（0V）を共有していない 2 台の電源をまたいだ負荷は、実機では帰り道が無いので電流が流れないが、2 ビットのモデルは「+ 側に届く」「0V 側に届く」がともに立つので**通電と誤判定する。** 0V コモンの繋ぎ忘れは実務で最も多い配線ミスの 1 つで、**本来このツールが真っ先に捕まえるべき誤りを、逆に「動きます」と答えてしまう。**

この持ち方で以下がすべて同じ 1 つの規則から従う。

| 状況 | 結果 |
|---|---|
| PS1 の + ─ 負荷 ─ PS1 の 0V | 通電 |
| PS1 の + ─ 負荷 ─ PS2 の 0V（0V 未接続） | **非通電**（`supplyMismatch`） |
| 上に加えて PS1 の 0V ─ PS2 の 0V | 通電（コモンを取れば 1 つの基準系） |
| PS1 の + と PS1 の 0V が同じネット | 電源短絡 |
| PS1 の 0V と PS2 の + が同じネット（直列接続） | **短絡ではない**（48V を作る正しい配線） |

判定はすべて `engine/potential.ts` に閉じる。`polarityAcross()` が「同じ 1 台の電源の + と 0V に届いているか」を見る唯一の場所で、コイル（§5.3）・ランプ・電流の向き（§5.10）はそこを通る。配線色（§5.6・§5.8）は「どれか 1 台に届いているか」で足りるので `reachesPlus()` / `reachesZero()` を使う。

**非通電の理由も言い分ける。** 両端がそれぞれ電源に届いているのに同じ電源ではない状態は `LoadPathExplanation.supplyMismatch` に立ち、プロパティパネルは接点の話をせずに「0V を共通にしてください」と言う（§5.11）。ここで「接点を閉じても届きません」と続けると、存在しない接点を探させることになる。

**`indicator` は現時点でどの定義も使っていない。** 単方向 LED を持つコイル（逆接で励磁はするが表示灯が点かない）のための値で、MY シリーズは §4.4 の照合の結果すべて `none` か `strict` に落ち着いた。値を残しているのは、この挙動が実在する部品の挙動であり、対応部品を足すときにエンジンを触らず定義 1 枚で済ませるため（CLAUDE.md 設計原則 2）。MY2N / MY4N の挙動と混同しないこと。

### 5.4 ダイオードの扱い（有向導通・`engine/diode.ts`）

単体ダイオードは一方向にしか導通しないため、無向グラフである DSU では原理的に表現できない。**そこで DSU は変えない —— ダイオードの 2 端子は今も union しない**（§5.2 の負荷と同じ扱い）。代わりに、ネットを組み終えた後の**電位の伝搬をアノード → カソードの一方向にだけ流す**。これが旧版で予告していた「2 パス探索」で、`computeNetStates()` の末尾で 1 回行う。

| 伝わるもの | 向き |
|---|---|
| `plusFrom`（+ 側に届いている電源） | アノード側ネット → カソード側ネット（順方向探索） |
| `zeroFrom`（0V 側に届いている電源） | カソード側ネット → アノード側ネット（0V からの後方到達可能性） |

**どの電源から来たのかも一緒に運ぶ。** ここで真偽値に潰すと、ダイオードの先で「別の電源の 0V」と組み合わさって通電と誤判定される（§5.3）。

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
type WireState =
  "inactive" | "plus" | "zero" | "energized" | "self-hold" | "short" | "analog"
```

| 値 | 条件 | 表示 |
|---|---|---|
| `inactive` | どちらにも到達しない | グレー・2px・不透明度 0.45（§5.8 の `isolated` と一致する線は破線・不透明） |
| `plus` | + 側のみ | 赤・2px・不透明度 0.55 |
| `zero` | 0V 側のみ | 青・2px・不透明度 0.55 |
| `energized` | 通電中の負荷に隣接するネット | 緑・3.5px・発光 |
| `self-hold` | 通電中のうち、自己保持しているリレー自身の接点が支えている枝（§5.9） | 紫・3.5px・流れる破線 |
| `short` | 両方に到達 | 赤・3.5px・点滅 |
| `analog` | 0–10V の調光信号が乗っている（§5.17） | 橙・2.5px・点線・不透明。電圧の値を線に添える |

判定順は **`short` を最初に置く。** 短絡したネットを緑（正常な通電）として描くと、最も危険な配線ミスが最も安全に見える。`self-hold` は **`energized` の中からだけ切り出す**（同じ理由で `short` を上書きしない）。

**`analog` は最後、`inactive` の直前に置く**（§5.17）。接点で 0V コモンへ落とした信号線（"DIRECT"）はコモンを電源の 0V に繋いでいれば**本当に 0V 線**になっているので、そこは青（`zero`）のままが正しい。この順にすることで橙が付くのは「導通の配色では灰にしかならないが、実際には効いている線」だけになる。

**アナログだけはレベルを濃淡に載せない。** 0V が 100%（全灯）という仕様では、レベルを不透明度へ写した瞬間に「最も明るい線が最も薄い」ことになり、この色を独立させた意味が消える。線は不透明のまま引き、レベルは**電圧の値そのもの**を線に添えて読ませる。

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
| コイルの自己遮断 | `coil-self-interrupt` | warning | 復帰位置ではコイルに電圧がかかるのに、接点を中間位置へ移すと消える（§5.14） |
| 発振 | `oscillating` | info | §5.5 の履歴一致 |
| 収束しない | `not-converged` | error | 100 回反復して安定しない |
| 調光の基準が共通でない | `analog-reference-mismatch` | warning | 調光出力のコモンと負荷側のコモンが別ネット（§5.17） |

**`unconnected-terminal` は調光信号の端子でだけ一言添える**（§5.17）。「未接続です。調光信号が未接続のため 0V として扱われ、出力は 100% になります」——挿し忘れると消えるのではなく全灯するので、使わない接点の未接続（info）と同じ重さにはせず warning にする。

#### 静的な配線チェック（`engine/wiring.ts`・停止中）

▶ を押すまで指摘が 1 件も出ないのは、**「実機を配線する前に確認する」というこのプロダクトの目的からするとひとつ遅い。** 未接続の端子も、還流ダイオードの逆挿しも、電源の直結も、通電させる前から配線図の上で決まっている。

`inspectWiring(document, definitions)` は **静止状態**（どのスイッチも操作されておらず、どのリレーも励磁していない）のネットを 1 回だけ構築し、上表のうち次の 3 つを返す。収束ループは回さず、状態も `SimulationResult` も持たない。

| 含める | 理由 |
|---|---|
| `unconnected-terminal` | ネットすら見ない純粋に静的な指摘 |
| `power-short-circuit` | 静止状態で + と 0V が繋がっているなら、通電の有無に関係なく配線の誤り。**B 接点は静止状態で閉じている** —— 押していないから安全、ではない |
| `diode-reversed` | 還流ダイオードの向きは「コイルと並列にどちら向きに入っているか」で決まる。`validation.ts` が明言しているとおり通電の有無を見ない |
| `analog-reference-mismatch` | 「調光出力のコモンと負荷のコモンが同じネットに居るか」は接点の開閉に左右されない配線そのものの性質。除外した `coil-polarity-reversed` と違い、出たり出なかったりしない（§5.17） |

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
| `analog` | どの電源にも届かないが、調光信号が乗っている（§5.17） | 橙・点線（実行中とまったく同じ見た目） |
| `isolated` | どちらでも到達しない | 灰・破線 |

判定順が §5.6 と同じく **`short` 先頭**なのも同じ理由 —— 最も危険な配線ミスを最も安全な見た目にしない。停止中に見つけた短絡を大人しい色にすると、実行した瞬間に色が変わって初めて気付くことになる。

**役割色と状態色は排他。** 実行中（`SimulationResult` がある間）も役割は計算するが、**色として使うのは停止中だけ。** 実行中に借りるのは `isolated` の 1 ビットを破線というパターンに使うところまでで（§5.6）、§5.6 の状態色以外の色は載せない。同じ線に 2 つの意味が同時に乗ると、色が「役割」なのか「今の電位」なのか読み手が判断できない。+ 側 / 0V 側だけは両方で同じ赤・青を使う（停止と実行で同じ線の色が変わらない）。

**`analog` を足したのは `isolated` から救い出すため**（§5.17）。調光信号線はどう動作させても電源には届かない —— 電源に繋ぐ線ではないのだから当然で、それを「配線漏れ」の灰破線で描くと**正しく描かれた調光配線がすべて直すべき線に見える。** 灰は「直すべき線」の合図であって「電源以外に繋がっている線」の意味ではない。橙は赤・青と同じく**停止中と実行中で色が変わらない**（役割と状態で意味が同じ唯一の色）。

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

#### 経路グラフの共有（`adapter/path-graph.ts`）

上記の経路グラフ・橋・2 辺連結成分は §5.10・§5.11 でも同じものを使うので、`self-hold.ts` から `path-graph.ts` へ切り出してある。**3 箇所で組み直さない** —— 「電線と閉じている接点だけを結び、負荷は結ばない」という §5.2 の規則が 3 つに増えると、片方だけ直した瞬間に色と経路が食い違う。

`path-graph.ts` が公開するのは次の 5 つ。

| 関数 | 返すもの | 使う場所 |
|---|---|---|
| `buildPathGraph` | 端子を頂点・導通を辺とする無向グラフ（+ 端子キー → `TerminalRef` の索引） | 下記すべて |
| `solvePathGraph` | 上記＋橋＋2 辺連結成分。**橋の計算は回路につき 1 回** | §5.9・§5.10・§5.11 |
| `orientedBridgesOnPath` | `from` → `to` で必ず通る橋を、通る順・**通る向き**で | §5.10・§5.11 |
| `bridgesOnPath` | 同上（向きを捨てたもの） | §5.9 |
| `reachableFrom` | ある端子から辿り着けるノード全部 | §5.11 |

向きを持たせたのは §5.10 のため。同じ道が §5.9 では「切れば落ちる線」（向き不要）、§5.10 では「電流がこちらへ流れる線」（向きが本体）になる。

### 5.10 電流の向き（`adapter/current-flow.ts`）

§5.6 の緑は「この線に電流が流れている」までしか言わない。だが回路を初めて読む人が最初に知りたいのは **どちらからどちらへ流れているか**であり、色の軸には載せられない（緑と紫はすでに別の意味を持っている）。そこで**動きの軸**を 1 本足す。

**ネットからは求まらない。** ネットは等電位の連結成分であって向きを持たない。向きが決まるのは「電源の + からこの線を通って負荷へ、負荷から 0V へ」という経路の上だけなので、§5.9 の経路グラフを使う。

1. 通電中の負荷（励磁コイル・点灯ランプ）の両端を、実際のネット状態から**入口 / 出口**に並べ替える（`orientLoad`）。**定義上の `positiveTerminal` を入口と決め打たない** —— 極性なしのコイルは逆接でも励磁するので 13 番が + 側に立ちうる（§5.3）
2. `@plus → 入口` と `出口 → @zero` の 2 本について `orientedEdgesOnPath` を呼ぶ。電流の上流を `from` に置くので、返る `tail → head` がそのまま電流の向きになる
3. 電線の辺（`connectionId` を持つもの）だけを拾い、`CircuitConnection` の `from` → `to` を基準に `"forward"` / `"backward"` へ落とす

#### 何に向きを付けるか

基本は**必ず通る線（橋）**。加えて、**入口と出口の間に並列に並んだ枝の束**にも向きを付ける（`orientParallelBundle`）。

**「並列だから向きが決まらない」は誤り。** 決まらないのは**どちらの枝を通るか**であって、**枝の中でどちら向きか**は別の問い —— 入口と出口の間に並んだ枝は、どれも入口から出口へ流れる。

これを落とすと**自己保持回路が必ず壊れる。** 自己保持は「保持接点を起動スイッチと並列に入れる」形なので、+ 側と合流点の間に必ず閉路ができ、そこに含まれる線は 1 本も橋にならない。結果、**保持接点まわりの 3 本ほどがまとめて向きを失う** —— 一番説明したい場所で矢印が消える。

向きを付けてよいのは、区間が次の 2 つを満たすときだけ。

1. **入口・出口以外の端子の次数がすべて 2。** 途中で枝分かれせず、区間の内側から外へ橋も出ていない。外へ橋が出ていると、そこから電流が抜けたり別の電源から入ったりして、区間の中だけでは向きが決まらない
2. **入口から出る枝が全部、出口へ着く。** 入口へ戻る環は電流が流れないので向きを持たない

この 2 つが揃えば各枝は単純な直列の鎖になり、入口のほうが出口より必ず電位が高いので、向きは入口 → 出口で確定する。**ホイートストンブリッジのように本当に向きが決まらない形は次数 3 以上の端子を持つので弾かれる。** 端子台（6 極短絡）を経由する並列も、短絡バーで次数が上がるので弾かれる。

**1 本でも条件を外したら区間ごと諦める。** 片方の枝にだけ矢印が出ると、出ていない枝が「流れていない」に見え、塗り漏れが誤読に化ける。

以上を通しても **塗り漏れ（向きが出ない線）はあっても、誤った向きは出ない。** §5.9 の紫と §5.11 の経路説明は今までどおり橋だけを使う —— あちらは「切れば落ちる線」「一本道の順序」という別の問いで、並列の枝は答えにならない（経路説明はその区間を `branched` として申告する）。

電源が 2 台あって同じ幹線を逆向きに使う回路では、1 本の線に相反する向きが載りうる。**そのときは向きを消す** —— どちらか一方を残すと、残った側が「正しい向き」として読まれる。

#### 表示

| 対象 | 表示 |
|---|---|
| 向きの決まった通電線（緑・実線） | 線の上を**背景色の切れ目**が流れる（`WireEdge.module.css` の `.flow`）。3px の切れ目・16px 周期 |
| 自己保持の紫（§5.9） | **切れ目は重ねない。** 線自身の破線の流れる向きを、電流の向きに合わせる |
| 凡例 | 実行中の 3 番目に「電流の向き」。**色ではなく動きの見本**なので、キャンバスと同じ周期で背景を流す |

切れ目を色ではなく**線の上の切り抜き**にしたのは、色を足すと §5.6 の色の意味を上書きしてしまうため。

**破線の線に切れ目を重ねてはいけない。** 自己保持の紫（`7 5`・0.6s）に切れ目（`3 13`・0.75s）を重ねると、**周期の違う破線が 2 つ重なって「п」「u」のような潰れた模様になる。** 紫はもともと線自身が流れているので、向きは `animation-direction` を反転させるだけで足りる。判定は `WireEdgeData.flowOnStroke`（自己保持のときだけ立つ）で行う。破線を持つ他の状態（`wireUnreachable` / `wireShort`）は通電していないので、そもそも向きを持たない。

**切り抜きは本体より太くする**（本体 3.5px に対して 4px、`stroke-linecap: butt`）。細いと切れ目の上下に元の色が細く残り、同じように形が潰れて見える。

**紫の破線はこれまで配線を引いた向きに流れていた。** `stroke-dashoffset` はパスの向き（`CircuitConnection` の `from` → `to`）に従うので、流れる向きは「ユーザーがどちら向きにドラッグしたか」で決まっていた —— 電気的には無意味であり、しかも読み手はそれを電流の向きと読む。§5.10 はこの誤読を潰すものでもある。

**動きを抑える設定（`prefers-reduced-motion`）では止める。** 切れ目そのものは残すので「電流が流れている線」であることは失われず、失われるのは向きだけ。向きは §5.11 の経路表示からも読める。

### 5.11 負荷 1 個の経路説明（`adapter/load-path.ts`）

配線の色は回路全体を一度に映すが、初めて回路を読む人の問いはいつも 1 個の負荷に向いている —— **「このコイルは何を通って励磁しているのか」**、そして動かないときの **「なぜ励磁しないのか」**。

どちらも色では答えられない。前者は経路（どの端子を順に通るか）であり、後者は**今そこに無いもの**（届いていない電源と、手前で開いている接点）だから。`explainLoadPath()` は実端子番号のまま言葉にして返す。抽象化された「リレー」ではなく `端子 13 / 14` を扱えることが本プロダクトの価値であり、経路の説明はそれが最も効く場所になる。

#### 通電しているとき —— 経路

§5.10 と同じ 2 本（`@plus → 入口`、`出口 → @zero`）の橋を、向き付きで辿る。橋の列から端子の並びを復元し、**同じ部品を続けて通る区間は 1 つにまとめる**（配線で入って接点を抜ける、が 1 行になる）。

```
PS1   +24V
S2    1 → 2
RY1   9 → 5      ← 自分の接点で保持している（§5.9 と同じことを言葉で）
コイル 14 → 13
PS1   0V
```

**橋の列が飛んだら `branched` を立てる。** 並列区間を跨ぐと前の辺の終点と次の辺の始点が一致しないので、黙って繋ぐと**通っていない端子を通ったことにしてしまう**。両端（`@plus` 側・負荷側）も突き合わせる —— 並列区間が経路の端にある場合は橋が 1 本も無く、「飛び」としては現れないため。

表示では負荷そのものを 1 行の見出し（「コイル 14 → 13」）で出すので、経路の端から**負荷自身の端子を 1 個だけ**外す（`trimLoadEnds`）。区間ごと落とすと、上の例の `RY1 9 → 5` —— 「何がこのコイルを保持しているのか」という肝心の情報が消える。

#### 通電していないとき —— 理由

1. 負荷の両端それぞれについて `reachableFrom` を取り、`@plus` / `@zero` に届いているかを見る
2. どちらの端子がどちらの電源を待っているか（`expects`）を決める。**すでに片側に電源が来ているならその向きを尊重する** —— 極性なしのコイルを逆接した回路で「14 に + が来ていません」と言うのは的外れ
3. 電源が届いていない側について、**閉じれば届く接点**を探す

3 は到達集合を 2 つ取るだけで求まる。負荷側から辿れる集合 `S` と、電源側から辿れる集合 `T`。**両側に足を掛けている開いた接点**がまさに切れ目の扉であり、候補ごとに探索し直す必要はない。

**開いている接点を片端から全部並べるのではない。** 閉じても電源に届かない接点まで挙げると、どれを直せばいいのか分からなくなる。

| 開いている組 | 出す条件文 |
|---|---|
| リレーの COM–NO | `RY1 が励磁すると閉じます` |
| リレーの COM–NC | `RY1 が非励磁に戻ると閉じます` |
| A 接点スイッチ（モーメンタリ / オルタネート） | `S1 を押すと閉じます` / `S1 を ON 位置にすると閉じます` |
| B 接点スイッチ（モーメンタリ / オルタネート） | `S1 を離すと閉じます` / `S1 を OFF 位置に戻すと閉じます` |

**開閉の規則そのものはここに書かない。** 今どれが閉じているかはエンジンの `conductingPairs()` に聞き、ここが持つのは「そもそも開閉する組はどれか」という定義の読み取りだけ（`inspection.ts` と同じ分担）。b 接点の端子を持たない a 接点リレー（G7L・§4.8）に COM–NC の組を作らないのも、`ncTerminal` の有無から自然に従う。

指摘できる接点が 1 枚も無い状態は 2 通りあり、UI はそれを言い分ける。

| 状態 | 出す文 |
|---|---|
| 両端ともどちらの電源にも届かない | 配線そのものが足りていない |
| 電源には届いているのに励磁しない | 接点ではなく極性の問題（§5.7 の `coil-polarity-reversed`） |

#### 置き場所

**停止中（`result` が `null`）は `null` を返す。** 動かしていない回路について「励磁していません」と言うと、消磁しているのか動いていないのかが区別できなくなる（§8.2 と同じ約束）。

エンジンではなく adapter に置くのは §5.8・§5.9 と同じ理由。

### 5.12 きっかけを見せる（`load-path.ts` + `simulation-view.ts`）

**自己保持を組むと、起動に使ったスイッチが画面から消える。**

実際に使われている先行優先回路で起きたこと —— セレクタ S1 を ON にすると RY1 が励磁するが、その瞬間に RY1 自身の b 接点が **起動経路を上流と下流の両方で切り、** S1 は両端とも非通電になる。画面上は「ON なのに灰色で、どこにも繋がっていないスイッチ」にしか見えない。読み手は当然「バグでは？」と思う。

このアプリは**時間軸を持たない**（§6-4）ので、「一瞬流れた」をそのまま描くことはできない。だが必要な情報は現在の回路から**すべて導ける** —— 履歴も、見せかけの時間も要らない。3 つに分けて出す。

#### ① ON なのに切り離されているスイッチ（`DeviceSimulationState.cutOff`）

スイッチが**操作されていて、かつ両端がどちらの電源にも届いていない**とき立つ。ノードに「回路から切離」と出し、ホバーのステータスも `active: false` に落とす（緑の強調は「今効いている」の意味なので、効いていない接点に付けると嘘になる）。

**警告色にはしない。** 配線ミスではなく、先行優先回路では正常な最終状態だから。読ませたいのは「壊れている」ではなく「今この接点は効いていない」。

判定は**端子の色を組み終わってから**行う。「ON なのに灰色」はまさに端子の色そのものから読み取れる矛盾であり、別の経路で導くと画面と食い違いうる。

#### ② 起動経路（`StartPath`）

**そのリレーが非励磁だった瞬間の経路。** 作り方は「自分の励磁だけを外した状態で経路グラフを組み直す」だけ —— 他のリレーは今の状態のまま置く（全部落とすと回路の別の場所まで巻き戻り、実際に起動したときとは違う道が出る）。`simulate()` は回さない。要るのは経路グラフ 1 枚で、収束の結果は問わない。

```
励磁している経路（保持）        起動した経路（今は切れています）
  PS1 +24V                      PS1 +24V
  SR  1 → 2                     SR  1 → 2
  RY1 9 → 5                     RY1 9 → 1
  コイル 14 → 13                 RY2 9 → 1
  PS1 0V                        RY3 9 → 1
                                S1  1 → 2
                                RY1 10 → 2
                                コイル 14 → 13
                                PS1 0V
  ※ 励磁した時点で RY1 の 9–1・10–2 が開き、この経路は切れました
```

押しボタンで起動した場合は見出しでそのボタンを名指す。

```
励磁している経路（保持）        起動した経路（S8 を押している間だけ通ります）
  PS3 +24V                      PS3 +24V
  RY7 9 → 5                     S8  1 → 2
  S8  2                         S9  1 → 2
  S9  1 → 2                     コイル 14 → 13
  コイル 14 → 13                 PS3 0V
  PS3 0V
  ※ S8 を離した今この道は切れていますが、上の保持経路が引き継いでいます
```

| 判断 | 理由 |
|---|---|
| **切れた接点が 1 つも無ければ出さない** | 起動経路が今も生きているなら、それは今の経路そのもの。同じ道を 2 度並べると、どちらが今なのか読めなくなる |
| リレーだけ | 「自分が非励磁だった瞬間」は自分の励磁を外して作るもので、接点を持たないランプには定義できない |
| **押しボタンは 1 個ずつ仮に押して引き直す**（`StartPath.trigger`） | 上の作り方だけでは**押しボタンで起動した自己保持に何も出せない。** 起動に使ったボタンはもう離れているので、今の操作状態からは経路が 1 本も引けず `null` になる —— ところが「どのボタンで動いたのか分からない」のはまさにその場面で、機能の意図と逆になる。離れているモーメンタリを 1 個ずつ仮に押し、経路が通ったらそのボタンを `trigger` として名指す |
| 仮押しの候補が 2 個以上なら出さない | どちらのボタンで起動したかは現在の状態から決まらない。片方だけ挙げると嘘になる |
| `trigger` のボタン自身は `breaks` に入れない | 開いているのは離したからで、それは `trigger` がすでに言っている。重ねると「接点が切れたせいで経路が死んだ」と読める |
| 仮押しはオルタネートを候補にしない | 今 OFF のオルタネートを押した経路は「起動に使った道」ではなく「これから使える道」であり、別の問い |
| 切れ目は**開閉する組だけ**を見る | 区間には電線で繋がっただけの端子ペアも混じる（同じリレーの `2 → 14` のように、接点ではなく電線で結ばれた 2 端子は 1 区間に畳まれる）。それを「導通していない」と数えると、切れてもいない場所を切れたと言うことになる |
| 表示は破線・薄い色 | 今は電流が流れていない経路を保持経路と同じ緑では描けない。§5.6 が待機線の濃さを落としているのと同じ軸 |

#### ③ 落とし方（`ReleaseAction`）

スイッチ 1 個ずつ「操作を反転させたら落ちるか」を `simulate()` で問う。**反転**なので、起動系（ON を OFF に戻す）と停止系（b 接点を押す）が同じ 1 つの規則で出る。

**現在の励磁集合を `previousEnergizedRelays` に渡すのが要点。** 渡さないと双安定な自己保持が毎回解けてしまい、どの操作でも「落ちる」と答える（§3.4）。

**落ちない候補も返す。** 自己保持回路では「起動に使ったスイッチを戻せば落ちる」が成り立たず、そこが最も誤解される点だから。ただし残すのは**今操作しているスイッチだけ** —— 触ってもいないスイッチまで「これでは落ちません」と並べるのはただの雑音。

```
落とすには
  SR を OFF にする
  ※ S1 を OFF にしても落ちません。
```

**活用形は文字列を継ぎ足して作らない。** 日本語の活用は語ごとに違い（"押す" → "押しても"、"OFF にする" → "OFF にしても"）、`action` に「しても」を足すと「OFF にするしても」になる。`ReleaseAction` が `action` と `concessive` を両方持つ。

#### 計算量

③ は選択中の負荷 1 個につきスイッチの数だけ `simulate()` を回す。`buildSelfHold`（§5.9）が励磁中のリレーの数だけ回しているのと同じ桁で、**通電中の負荷を選んでいるときだけ**走る。②は経路グラフ 1 枚ぶんで、収束ループは回さない。

#### 表示

| 対象 | 表示 |
|---|---|
| 保持経路の配線 | 紫・3.5px・流れる破線（`--wire-self-hold`）。破線を併用するのは色覚に依存させないため |
| 保持経路の端子 | 同じ紫（端子だけ緑に残すと接点の手前で色が途切れる） |
| 自己保持中のリレー | ノードを紫で縁取る。ホバーのステータスも「励磁中」ではなく「自己保持中」 |
| プロパティパネルの端子一覧 | 端子番号のチップを紫、状態欄に「自己保持」 |
| プロパティパネルのコイル状態 | 「励磁中」ではなく「自己保持中」 |

選択中のノードでは縁取りを譲る。選択の枠（`--accent`）は今まさに操作している対象を指すもので、状態表示に奪われると何を掴んでいるのか分からなくなる。

### 5.13 タイマー（時間の導入・`engine/timer.ts`）

オンディレイ（限時動作）とオフディレイ（限時復帰）を扱う。**§6-4 の「時間の概念がない」を一部だけ崩す変更**であり、崩し方を最小に保つことがこの節の主題。

#### タイマーは「遅れて動くリレー」

`ElectricalDefinition` に `kind: "timer"` を**作らない。** `kind: "relay"` に省略可能な `delay: TimerDelay` を足して表す（§3.2）。実機のタイマーリレーはリレーであり、コイルも接点も同じものを持ち、違うのは接点が動くタイミングだけ。`kind` を分けると接点・コイル・端子まわりの分岐がエンジンと adapter の各所で 2 本になり、片方だけ直す事故が起きる。

この形にしたことで、以下は**リレー用のコードがそのまま効く**（差分 0 行）。

- 極性判定（§5.3）・接点の開閉（§5.1）・未接続端子（§5.7）
- 自己保持の検出（§5.9）・電流の向き（§5.10）・経路説明（§5.11）
- 接点の図記号（§8.11・`ContactDiagram` を `RelayBody` と共有）

`category: "timer"` を新設しているのはパレットの見出しと図記号の出し分けだけで、電気的な意味は持たない。

#### 時計はストアだけが持つ

**エンジンは `performance.now()` を呼ばない**（CLAUDE.md 設計原則 1）。時刻は `SimulationInput.nowMs`（開始からの経過ミリ秒）として受け取る。

| 置き場所 | 役割 |
|---|---|
| `simulationStore` | `performance.now()` を読み、`start()` からの差を `nowMs` として渡す |
| `simulate()` | `nowMs` を受け取るだけ。純粋関数のまま |
| テスト | `nowMs` を直接指定。設定時間の 1ms 手前と丁度という境界を実時間を待たずに突ける |

これが逆（エンジンが時計を読む）だと、`timer.test.ts` の 20 件はそもそも書けない。

#### 状態は 2 つだけ持ち、出力は導く

```ts
type TimerState = {
  coilOn: boolean            // コイルに電圧がかかっているか（今この瞬間）
  changedAtMs: number | null // coilOn が今の値になった時刻。null = 開始からずっと
}
```

出力（接点が動いているか）は**保持しない。** `coilOn` と経過時間と設定時間から必ず導けるものを別に持つと、片方だけ更新されてずれる。導出は `timerOutputOn()` の 1 箇所。

| モード | 出力 |
|---|---|
| `on-delay`（限時動作） | `coilOn && 経過 >= 設定` |
| `off-delay`（限時復帰） | `coilOn \|\| 経過 < 設定` |

**`changedAtMs: null` を「経過 = ∞」と読むのが要点。** 0 で初期化すると「たった今入力が切れたところ」と読まれ、**一度も入力していないオフディレイが電源投入と同時に動作する。** ∞ なら「とっくに復帰済み」が自然に出る。

#### 収束ループの拡張

反復 1 回の中で、遅延なしのリレーは今までどおり「コイルの励磁＝接点の切替」。タイマーだけ `advanceTimer()` → `timerOutputOn()` を通す。

**`previousTimers` は 1 回の `simulate()` の中で固定する。** 反復のたびに更新すると途中経過で `changedAtMs` が打ち直され、経過時間が常に 0 になって設定時間へ到達しない。時間が進むのは呼び出しをまたいだときだけ。発振検出（`signature`）は切替集合を見ているので、タイマー出力もそのまま乗る。

`previousTimers` は `previousEnergizedRelays` と**同じ性質の落とし穴**（§3.4）。渡し忘れると毎回「今この瞬間に入力が入った」ところからやり直すので、オンディレイの接点が永久に動かない。

#### 再計算を回す条件

`SimulationResult.nextEventAtMs`（次に接点が変わる時刻の最小値）を返し、ストアはこれがあるあいだだけ **50ms 間隔**で解き直す。無ければループを止める。

- `requestAnimationFrame` は使わない。タイマーを 1 個も置いていない回路で CPU を回し続けることになる
- 判定に「タイマーが置いてあるか」を使わない。入力の入っていないタイマーを置いただけで回り続ける
- 到達済みのタイマーは `nextEventAtMs` を返さない。返し続けると**時計が止まらない**（`timerNextEventAtMs` が経過時間を見る理由）

50ms は残り時間の表示を滑らかにするための値。接点が変わる瞬間の誤差は最大でこの幅だが、秒単位のタイマーでは見えない。

**`nextEventAtMs` の意味は Step 23 で広がった**（§5.18）。フェードが入ったことで、返る時刻は「次に接点が変わる時刻」（離散）だけでなく「フェードが変わり終わる時刻」（連続）も指すようになった。**それでもストア側は 1 行も変わっていない** —— ここが読んでいるのは「まだ動いているか」の 1 ビットだけで、刻みはストアが固定の 50ms で決めているから。連続なものは「終わる時刻」を返せばよく、途中の値は 50ms ごとの解き直しでエンジンが出す。到達済みで `undefined` を返す約束は両方に共通で、破ると時計が止まらない。

#### コイルと接点を取り違えない

**`energizedRelays` は「接点が切り替わっている」であって「コイルが励磁している」ではない**（§3.4）。オンディレイは設定時間のあいだ「コイルは入っているが接点はまだ」の状態にいる。

コイルの側を見たい場所では `coilEnergized()` を使う。取り違えると、**計測中のタイマーのコイル配線が非通電（灰色）に見え、電流の矢印も消え、経路説明が「通電していません」と答える** —— 一番読みたい場所がまとめて消える。

| 見る場所 | 使うもの |
|---|---|
| ネットの組み立て（`buildNets`）・接点の図記号 | `energizedRelays`（接点） |
| 配線色（§5.6）・電流の向き（§5.10）・経路説明の `active`（§5.11） | `coilEnergized()`（コイル） |

#### 設定時間はインスタンスごと

`CircuitComponentInstance.presetMs`（§3.3）。実機のダイヤルに相当し、定義に固定すると「3 秒の T1 と 10 秒の T2」を同じ型番で置けない。プロパティパネルでは**秒で入力させる**（内部は ms）。ラベルと違い **Undo の対象**にする —— 設定時間は回路の動きそのものを変えるので、間違えたときに戻せないと困る。

#### 表示

| 状態 | ノードの表示 |
|---|---|
| 入力なし | 「限時動作 2.0秒」（設定時間。**停止中も出す**ので `simulation` ではなくノードデータの `presetMs` から読む） |
| 計測中 | 「残り 1.3秒」（`--wire-plus` 色。動作中と**別の色**にする） |
| 動作中 | 「動作中」（`--wire-energized-text`） |

計測中を独立した見た目にするのは、ここを「まだ動いていない」と同じ絵にすると**タイマーが動き出したのか配線を間違えたのかが読めない**ため。待っている時間こそタイマーで一番見たいところ。

操作バーの経過時間は**タイマーを置いた回路でだけ**出す（`result.timers.size > 0`）。時間の概念が要らない回路にまで秒数を出すと、「時間で何かが変わる回路なのか」という誤った期待を持たせる。判定に `nextEventAtMs` を使わないのは、計り終わるたびに表示が消えてちらつくため。

### 5.14 自分の接点で自分のコイルを切る配線（`engine/chatter.ts`）

**収束計算では原理的に見つからない誤りがある。** §5.5 の収束ループが探すのは「接点の状態とコイルの状態が矛盾しない組み合わせ」＝安定解であって、**接点が切り替わる途中は状態として存在しない。** ところが実機の c 接点は break-before-make —— COM が NC を離れてから NO に着くまでに、必ずどちらにも繋がっていない瞬間がある。

この瞬間にコイルの給電が消える配線は、実機では吸引と復帰を繰り返して唸る（チャタリング）。典型は**起動経路を自分の b 接点に通し、自己保持を自分の a 接点で取る**配線で、安定解としては何の矛盾も無いため `simulate()` は `stable` を返し、ランプも普通に点く。**実機だけが唸る。** 実端子番号で実機どおりに配線できることを価値に置く以上、この差は埋める。

判定は 2 段階で、どちらも**実際にネットを組み直して聞く**。接点の開閉規則をここへ書き写さない（規則は `closedContactPairs()` 1 箇所に閉じる）。

| 段 | 状態 | 判定 |
|---|---|---|
| ① | **そのリレーだけ**復帰位置に戻す（他のリレーは収束した状態のまま） | コイルに電圧がかからなければ、そもそも吸引しないので終了 |
| ② | ①の状態から、そのリレーの接点だけ**中間位置**（NC も NO も開）へ移す | まだ電圧が残るなら唸らない —— 外部のスイッチや他のリレーの接点で給電されており、自分の動作に邪魔されていない |

①が成り立ち②が成り立たないとき、コイルは自分の接点で自分を切っている。中間位置は `buildNets()` の `OpenContacts`（componentId → 接点 ID の集合）で作る。**通常の収束ループには渡さない** —— 中間位置は安定状態ではなく、解として求めるものではない。

そのあと接点を 1 つずつ開いて、どれが効いているかを端子番号まで特定して本文に載せる（「端子 10–2」）。全部開くと切れるが単独では切れない配線（自分の接点を通る経路が複数ある）もありうるので、特定できなければ端子を挙げずに本文だけ出す。

**severity は warning。** 自分の接点で自分を切る配線はブザー（バイブレータ）そのものでもあり、意図して組むことがある。`oscillating` を info に留めているのと同じ理由で、エラーとして赤く出さない（§5.5）。

**タイマー（`delay` を持つリレー）は対象外。** 限時のぶん接点が遅れて動くので、同じ配線は「唸り」ではなく設定時間を周期とする点滅（フリッカ）回路になる。実際にそう組む回路がある以上、警告にすると正しい配線を否定することになる。見ているのは `delay` の有無だけで、`category` も型番も見ない（CLAUDE.md 設計原則 2・7）。

**呼ぶのは収束した後、1 回だけ。** 反復の中で解くものではなく、確定した状態に対する後付けの検査になる。`inspectWiring()`（§5.7 の静的チェック）には**含めない** —— 静止状態ではどのスイッチも操作されておらず、①のコイル電圧が成立しないので 1 件も出ない。出ない指摘を混ぜても「出なかった＝正しい」と読まれるだけで害がある。

### 5.15 電位の到達範囲（`engine/preview.ts` + `adapter/path-preview.ts`）

**▶ を押す前に、電源からどこまで電位が届いていて、どこで止まっているかを読めるようにする。** 実機を配線する前に確認する、というこのプロダクトの目的からすると、経路が読めるのが実行中だけなのはひとつ遅い。§5.7 の静的な配線チェックが「誤りを言う」側なのに対し、ここは「**今どうなっているか**を見せる」側。

**§5.8 の役割配色とは問いが違う。** あちらは「この線はいつか電源につながるか」（3 通りのネットを見た静的な役割）で、接点の先の線をまとめて制御線＝黄にする。ここが答えるのは「**今この瞬間**どこまで来ているか」で、その黄を「届いている / まだ届かない」に割る。片方だけでは分からないものが両方にあるので、どちらも残して排他で切り替える（§8.14）。

解くのは §5.7 と同じ **1 パスだけ**で、収束ループは回らない。同じ 2 行を 2 箇所に書かないよう、`graph.ts` の `solveWithoutRelays()` を `wiring.ts` と共有する —— 警告に出る回路と画面に出る色が別の状態を指すことがあってはならない。

#### スイッチは倒せる。リレーは動かない（Step 16 で確定）

**この境目がこのモードの定義そのもの。**

| | 入力として効くか | なぜ |
|---|---|---|
| スイッチ（押しボタン・切替） | ○ `SimulationInput.pressedSwitches` | **人が倒すもの。** 倒した結果は回路を解かなくても決まっているので、1 パスのまま扱える |
| リレー・タイマーの接点 | × `NONE_ENERGIZED` 固定 | **回路を解いた結果でしかない。** 動かすと「動いた接点で別のリレーが動く」の連鎖になり、収束ループ＝▶ が必要になる |

倒せるようにしたのは、実機を配線する前の確認が「S1 を入れたらどこまで電気が来るか」を指でなぞる作業だから。**倒す操作までを ▶ に預けると、時間・自己保持・タイマーが一度に付いてきて、読みたいものが結果に埋もれる。**

一方でリレーまで動かすと、それは「時間の進まない ▶」でしかない。タイマーを 0 秒後で読むのか無限後で読むのかという答えの無い問いも抱え込む。**線はスイッチとリレーの間に引く** —— 人が決めることは入力、回路が決めることは ▶ の領分。

この境目は `solveWithoutRelays()` の名前と引数で守る。スイッチは `input` で渡せるが、リレーの励磁を渡す口がそもそも無い。

そのため **コイルが励磁色になっても、そのリレーの接点は開いたまま**という状態が正常に起こる。黙っていると自己保持もインターロックも壊れて見えるので、一覧に必ず添える（§8.14）。

#### 電位が止まっている箇所（`PreviewBlocker`）

**この機能の主役。** 到達範囲は色で一目で分かるが、**止まっている場所は画面に無い** —— 開いている接点は線が繋がっていないので、見るべき場所そのものが描かれていない。ここが「RY1 の 9 → 5」と端子番号で言う。

判定は、部品の中で**開いている**端子ペア（`graph.ts` の `openPairs()`・接点は `relay.ts` の `openContactPairs()`）を取り、片側だけが電源のある側に届いていれば先端とする。

| 状況 | 先端か | 理由 |
|---|---|---|
| 片側に + が届き、反対側には届かない | ○ | 閉じれば電位が先へ進む |
| 両側とも同じ側に届いている | × | 閉じても何も変わらない |
| どちらにも届いていない | × | まだ手前で止まっている。その手前が先端 |
| 片側が +、反対側が同じ電源の 0V | × | **閉じれば短絡。** 負荷は union されない（§5.2）ので、その 2 端子の間に負荷は無い |

最後の行が要点で、`spansSupply()` で除外している。短絡は `detectPowerShortCircuits()` の担当であって、「あと少しで励磁します」の顔で出してよいものではない。

#### 成立している負荷

その状態でコイルに電位差がかかっているリレーとランプは `evaluateCoil()` / `polarityAcross()` で判定する —— **`simulate()` と同じ規則を使い回す。** ここに独自の判定を書くと、経路確認では励磁すると出ているのに ▶ を押すと励磁しない、という食い違いが起きる。

見るのは**コイルの側**（`energizedCoils`）であって接点ではない（CLAUDE.md 設計原則 8・§5.13）。タイマーは静止状態でも「コイルは入っているが接点はまだ」の位置に立ちうるので、接点で見ると計測を始めるはずのコイル配線が灰色になる。このモードでは接点が一切動かないので、**ここは常にコイルだけを指す。**

**押しボタン式の普通の制御回路では、どのスイッチも倒していない状態で励磁する負荷は 1 個も無い。** それが正常なので、0 件を異常として出さない。逆に 1 件以上あることは「動かす前から励磁している」という手がかりなので、件数を一覧に出す（§8.14）。

#### 返す型

`SimulationResult` にはしない（`PathPreview`）。`warnings` も `status` も `iterations` も持たないものを同じ型で名乗ると、受け取った側が「収束した結果」として扱う。収束させていないという事実を型に残す（`inspectWiring()` が `SimulationResult` を作らないのと同じ理由）。

色は `adapter/path-preview.ts` が付ける。**`WireState`（§5.6）をそのまま使い、予測専用の色を作らない** —— 「+ 側が来ている」の意味は動かしていても止まっていても同じで、色相まで変えると読み手が 2 つの語彙を覚えることになる。予測であることは色ではなく**描き方**（破線・発光なし）で表す（§8.14）。緑を塗る規則（`loadNetIds()`）は `simulation-view.ts` と共有する。

**`deviceOf` は空のまま返す。** `DeviceNodeData.simulation` の有無が「シミュレーション中か」を表す唯一の合図（§8.1）で、そこへ予測を混ぜると部品が動いているように見える。塗るのは端子と配線だけで、励磁するコイルはその両端の線が通電色になることで読める。

---

### 5.16 実体配線 → ラダー図（`adapter/ladder.ts`）

キャンバスに描いてあるのは**実体配線図**（どの端子とどの端子を電線で結んだか）で、これは本プロダクトの価値そのものだが、**回路が何をする回路なのかを読むには向いていない。** ラダー図はその逆で、端子の位置を捨てて「左の母線から条件（接点）を通って出力（コイル・ランプ）へ至る段」の並びだけを見る。

生成は 1 方向だけ。**逆変換（ラダー図を描いたら配線が出る）は範囲外**（`requirements_definition.md` §8）—— ラダー図には接点が何番の端子かを書く場所が無く、実端子への割り当てが一意に決まらない。

#### 何を枝にするか

`buildNets()`（§5.1）と**束ね方が違う。**

| | `buildNets()` | ラダー図 |
|---|---|---|
| 電線・端子台 | union する | union する |
| 閉じている接点・スイッチ | union する | **union しない**（枝として残す） |
| 開いている接点・スイッチ | 別ネット | **枝として残す** |
| 負荷（コイル・ランプ） | union しない | union せず、段の**出力**にする |
| ダイオード | 有向に電位を伝える | **枝にしない**（下記） |

接点を開閉に関わらず枝のまま残すのが要点。ラダー図は**状態のスナップショットではなく回路の論理**なので、「今どちらへ倒れているか」を織り込んではならない。非励磁のリレーの b 接点は今は閉じているが、図には b 接点として出る。だから `conductingPairs()` は使わない —— あれは「今」を答える関数で、問いが違う。

束ねる道具（`UnionFind`）はエンジンから公開して使い回す。束ね方が違うだけで、束ねること自体は同じ操作。

#### 直列・並列への縮約

2 端子網（母線 → 出力）を次の 3 規則の繰り返しで 1 本の枝に潰す。どの規則も枝か節点を 1 つ減らすので必ず止まる。

1. **並列** … 同じ 2 端点を結ぶ枝どうしを 1 本にまとめる
2. **直列** … 端点でも分岐点でもない次数 2 の節点を消して 1 本にまとめる
3. **刈り取り** … 行き止まり（次数 1 の節点）の枝を捨てる。電流が通らないので図にも出ない

1 本に潰れなければ、その回路は**直列と並列だけでは表せない**（ブリッジ回路）。そのときは近い形を出さずに「出せない」と言う —— 「だいたい合っている図」は実配線と照らす道具にならない。母線に届いていない配線も同じで、どちら側に届いていないかを言う。**黙って空の段を出さない。**

#### 出力の向きは母線からの到達で決める

**コイルの極性で決めない。** 実配線では接点をコイルの 0V 側に入れる書き方も普通にあり（§5.9 の自己保持を 0V 側に組む形）、極性で決め打つと図が左右さかさまになる。+ 側から辿り着ける端子を入口、0V 側から辿り着ける端子を出口にする。

0V 側にあった接点は、ラダー図の決まりに合わせて**出力の左へ移す**。移したことは段に残し（`movedFromZeroSide`）、断り書きとして画面に出す —— 図と実配線で接点の位置が違って見えるため。

#### 電源が 2 台以上あっても母線は 1 組

ラダー図に電源の台数を表す場所が無い。黙って束ねると別系統の回路が 1 枚の図に見えるので、束ねたことを断り書きに出す。

#### ダイオードは図に出さない

還流ダイオードはコイルと**並列**に入る実装上の部品で、ラダー図の論理には現れない。枝として残すとコイルの両端が短絡した形になり、段が壊れる。直列に入れた場合もその経路は数えないので、その旨を断り書きに出す（§6-8）。

#### 図と同じ内容の文を 1 箇所で組む

`rungText()` が段 1 本を文にする（`S2 1-2[b] — (S1 1-2[a] ∥ RY1 9-5[a]) → RY1 コイル 14-13`）。画面の読み上げと検証がこれを共有する。**図と文を別々に組み立てない** —— 片方だけ直す事故が起きる。

### 5.17 調光（アナログ量の導入・`engine/analog.ts`）

実機の調光盤は 3 層でできている。接点で組んだ制御回路（§5.1〜§5.5）、AC100V を電磁接触器で入り切りする負荷側（§4.12・§4.13）、そして **0–10V のアナログ量で明るさを決める調光**。ここが入らないと、盤の中心にある「調光」そのものが図に描けない。

**この盤の調光仕様は逆特性で、0V = 100% / 10V = 0%。** 一般的な 0–10V 機器（0V = 消灯）と真逆で、この 1 点が以下すべての判断に効く。

#### 導通レイヤに重ねる第 2 パスにする

ネットの分割（Union-Find・§5.1）も `NetState`（どの電源の + / 0V に届くか・§5.3）も**変えない。** 組み終わったネットの上に電圧値を重ねる —— ダイオード（§5.4）が DSU を変えずに電位を一方向へ流しているのと同じ場所・同じ手口で、負荷を union しない原則（§5.2）にも触れない。

重ねる側にした理由は 3 つあり、どれも「混ぜると壊れる」ことに尽きる。

1. **0V を出している調光信号線は電源の 0V ではない。** `NetState` に混ぜると電源短絡の判定（§5.7）と配線色（§5.6）に紛れ込み、**正しい配線が最も危険な警告で真っ赤になる**
2. **0V = 100% の仕様では、0V の線こそ全灯している線。** 導通の配色に載せると `zero`（青）か `inactive`（灰・不透明度 0.45）になり、**効いている線が効いていないように見える**（CLAUDE.md 設計原則 8 —— タイマー計測中のコイル配線が灰色に見える事故と同じ種類）
3. **接点で信号線を 0V へ落とす配線（実機盤の "DIRECT"）は既存の Union-Find がそのまま表している。** アナログのために別のグラフを作る必要が無い

その結果、**電源短絡の判定は 1 行も変えていない。** `detectPowerShortCircuits()` が回るのは `kind: "power"` の部品だけで、調光出力（`analog-source`）はそのループに最初から入らない。調光信号を 0V に落とすのがこの仕様では正常な操作（全灯）である以上、機械的に当たらないことが要件（requirements.md ⑤）。

#### 収束ループの中で解く（Step 22 で変更）

**当初は「アナログ量は接点を動かさないので収束ループの中には入れない」としていた。** カットリレー（§4.16）がこれを崩す —— 明るさが接点を動かし、接点がネットの形を変え、ネットの形が明るさを決める。コイルと接点の相互依存とまったく同じ構造なので、**同じ不動点反復で解く。**

**層の分け方は変えていない。** `NetState` に電圧は混ざらず、アナログは今もネットの上に重ねる第 2 パスのまま。変わったのは**解く順番だけ**（CLAUDE.md 設計原則 9）。反復のたびに「ネットを組む → コイルとアナログを評価 → 接点を決める」を回し、収束の判定は励磁状態と動作接点の**両方**を見る。

発振の検出も両方を見る。アナログ量で動く接点が自分の明るさを変える配線は、コイルの自励発振と同じ周期に入りうる。

#### V → % の変換は定義側の宣言に閉じる

エンジンが読むのは**電圧だけ。** `if (model === "FMD-701D") invert` と書けば設計原則 2 が崩れるうえ、順特性の機器を足すたびにエンジンが分岐で埋まる。対応は `AnalogCurve`（§3.1）という宣言で定義側が持ち、`analogPercent()` は 1 次補間 1 本で両向きを出す。順特性の機器は `percentAtMin` / `percentAtMax` を入れ替えるだけで足り、`engine/analog.ts` は 1 行も変わらない。

#### 調光ランプは `kind` を増やさない

調光ランプは `kind: "lamp"` に `dimming?: DimmingInput` を足しただけ（§3.1）。タイマーを `relay` の `delay` で表したのと同じ形（CLAUDE.md 設計原則 7）で、点灯条件（両端が同じ 1 台の電源の + と 0V に届くか）は普通のランプとまったく同じ。`kind` を分けると点灯判定・経路説明・図記号・ラダー図の分岐がすべて 2 本になり、片方だけ直す事故が起きる。

**違いは 1 つだけ** —— `litLamps` に入るのは明るさが 0% より大きいときに限る。電源が来ていても 10V（この仕様では 0%）なら光っていない。逆に明るさ 100% でも電源が来ていなければ点かない。明るさと点灯は独立した 2 つの軸で、潰すと「消えている理由」が読めなくなる。

増えたのは `analog-source` の 1 通りだけ。電位を配る `power` でも電位差を受ける `lamp` でもなく、**基準に対する電圧値を出す**という別の振る舞いなので、既存のどれにも寄せられなかった。

#### 解き方

```
1. 調光出力を信号ネットごとの電圧に畳む（collectSignals）
2. 調光入力を持つ負荷ごとに、信号ネットの電圧から明るさを出す（levelOf）
```

| 状態 | 判定 | 結果 |
|---|---|---|
| 信号ネットと基準ネットが**同じネット** | 接点で 0V コモンへ落とした（"DIRECT"） | 0V（＝この仕様では 100%） |
| 信号ネットに信号が乗っていない | 挿し忘れ・繋ぎ忘れ | 定義の `unconnectedVolts` |
| 信号は来ているが**基準ネットが一致しない** | GND を共通にしていない | `unconnectedVolts`（信号が成立しない）＋ 警告 |
| それ以外 | 正しく配線されている | 出力の電圧 |

**"DIRECT" が特別扱いになっていないのが要点。** 「基準に対する電圧が 0」というネットの形からそのまま出る答えで、接点が閉じれば信号ネットと基準ネットが 1 つになる —— 既存の Union-Find が何も足さずに表している。

#### 基準が共通でない信号は成立しない

0–10V は**基準に対する**電圧なので、リターンが共通でないと電圧そのものが意味を持たない。これは §5.3 の `supplyMismatch`（基準を共有していない 2 台の電源をまたいだ負荷は通電しない）とまったく同じ話で、**接点の話をしない**ところまで同じ —— 直すべきなのはコモン線 1 本であって接点ではない。

成立しない以上、入力段は未接続と同じ状態にある。だから `unconnectedVolts` へ落とす —— **0V = 100% の仕様では、これも全灯になる。**

この判定は接点の開閉に左右されないので、`inspectWiring()`（停止中の配線チェック・§5.7）にも入れてある。除外した `coil-polarity-reversed` と違い、静止状態で答えが決まり、出たり出なかったりしない。

#### 同じネットを複数の出力が駆動したら低いほうが勝つ

実機で 2 つの出力段を並列に繋ぐのは本来やってはいけない配線だが、この規則には根拠がある —— 接点で 0V コモンへ落とす "DIRECT" はまさに「外から引き下げる」操作で、**引き下げが勝つ**という同じ 1 つの規則の極端な場合になる。出力段のインピーダンスはモデル化しないので、どちらが強いかをこれ以上細かく決める材料が無い（§6-3）。

#### 挿し忘れが全灯として警告される

**本スコープで最も価値のある警告。** 0V = 100% なので、**調光信号線を挿し忘れる／抜けると全灯する。** 一般的な機器と真逆で、しかも「消えている」より気付きにくい。

`detectUnconnectedTerminals()` はすでに全部品の全端子を舐めているので、そこに一言添える（§5.7）。**何 V になるかはエンジンが決め打ちしない** —— プルアップかプルダウンかは実機の入力回路次第で、ここに 0 と書いた瞬間に順特性の機器で嘘になる。定義の `unconnectedVolts` を読み、その値から `AnalogCurve` で % を出して文にする。

#### 端子には V、部品には %

V → % の対応は**受け側の機器の性質**（`AnalogCurve`）で、同じ 5V でも順特性の機器を繋げば別の明るさになる。だから線と端子には V しか出さず（そこには「何 V が来ているか」しか無い）、% は変換規則を持っている部品の側に出す。調光出力の本体に出るのも V —— ここで % と書くと、逆特性という受け側の性質を出力側の性質だと読ませてしまう。

| 出す場所 | 単位 |
|---|---|
| 配線（`WireEdge` の値ラベル） | V |
| 端子のツールチップ（`DeviceTerminal`） | V |
| 調光出力の本体（`DimmerBody`）・プロパティパネルの「出力」 | V |
| 調光ランプの本体（`LampBody`）・プロパティパネルの「明るさ」 | %（と V を括弧で併記） |

**ランプの明るさは塗りの濃さにも載せる**（`fill-opacity`）。配線の薄さは「電流が流れていない」を意味するので調光レベルを載せてはいけないが、**ランプの塗りの濃さは明るさそのもの**であり、写して嘘にならない。それでも塗りだけには頼らず数字を必ず併記する（要件書 §8）。

#### 出力電圧はインスタンスに持つ

`CircuitComponentInstance.outputVolts`（§3.3）。実機の調光出力はつまみや設定で決めるもので、タイマーの `presetMs` とまったく同じ扱い —— 定義に固定すると「10V の DIM1 と 4V の DIM2」を同じ型番で置けなくなる。範囲外は `outputVoltsOf()` が定義の上下限へ丸め、プロパティパネルは V で入力させる（Undo の対象）。

#### 出力は回路ごと（Step 21 で拡張）

`analog-source` は**チャンネルの配列**を持つ。実機の調光コントローラは 0–10V を 16 回路持ち、回路ごとに違う電圧を出す。**1 回路の機器も 1 要素の配列で表す** —— 単数と複数で形を分けると、畳み込みも定義もインスタンスの設定も 2 本になり、片方だけ直す事故が起きる。

インスタンス側は `channelVolts`（チャンネル ID → V）。旧書式（1 回路ぶんの `outputVolts`）は読み込み時に第 1 チャンネルへ移す —— 保存済みの回路を開いたときに設定した明るさだけが黙って既定値へ戻るのが一番たちが悪い。

#### 明るさはネットにも乗る（`netLevelOf`・Step 21 で追加）

位相制御調光器は自分が点る負荷ではなく**通り道**なので、明るさは部品ではなく**出力回路のネット**に乗る（§4.15）。ランプ側の優先順は次のとおり。

1. 自分の調光入力（`dimming`）が最優先
2. 無ければ、乗っている回路の明るさ（`netLevelOf`）
3. どちらも無ければ普通のランプ

**自分で信号を受けているランプが調光器側に負けてはいけない。** 直に受けている信号のほうが具体的で、そこを逆にすると「繋いだ信号線が効かない」という読めない挙動になる。

#### ラダー図には出さない

ラダー図（§5.16）は接点の論理を表す図で、アナログ量を描く場所が無い。調光信号を接点で 0V に落とす配線も段にはならない。ダイオードと同じく、断り書きで理由を出す（§6-7）。**調光ランプ自体は普通のランプとして出力に出る**ので、「どの条件でこのランプに電源が入るか」までは図に残る。

### 5.18 フェード（時間をかけた明るさの変化・`engine/fade.ts`）

調光出力が出す 0–10V が、設定した時間をかけて目標値へ動く。**§5.17 の調光に時間を入れる変更**で、崩し方を最小に保つのがこの節の主題。土台は §5.13 のタイマーがそのまま使える —— 時計を持たない・実行時状態を返す・`nextEventAtMs` を返す、の 3 点が既にある。

#### フェードするのは「出力する電圧」であって「受け側の明るさ」ではない

実機の盤で時間をかけているのは**コントローラ**で、位相制御調光器は来ている 0–10V に追従しているだけ。だから `analog-source` が出す電圧のほうをランプさせ、入力段（`inputLevel()`）は 1 行も変えない。

この置き方から 3 つが自動的に決まる。

| | 結果 | 理由 |
|---|---|---|
| 接点で 0V へ落とす配線（"DIRECT"） | **瞬時のまま** | 機器の外の短絡で、出力段を通らない |
| 配線の V ラベル・端子ツールチップ | **無変更で滑らかに動く** | `analog.signalOf` を読んでいるため |
| カットリレー（§4.16） | フェード中に動作点をまたいで動く | `resolveAnalog()` は Step 22 から収束ループの中にある |

受け側のソフトスタートを作らなかったのは、状態を入力段 3 種（ランプ・調光器・カットリレー）それぞれに持たせることになり、**「どちらのフェードで遅れているのか」が画面から読み分けられなくなる**ため。

#### 状態は 3 つ持ち、電圧は導く

```ts
type FadeState = {
  targetVolts: number         // channelVolts から決まる目標
  fromVolts: number           // ランプを開始したときの電圧
  changedAtMs: number | null  // 目標が今の値になった時刻。null = 開始からずっと
}
```

`TimerState`（§5.13）とまったく同じ構えで、**今出している電圧は保持せず `fadeVoltsOf()` で導く。** 保持すると目標・開始値・経過時間との四重管理になり、片方だけ更新されてずれる。

**`changedAtMs: null` を「経過 = ∞」と読むのも同じ。** 0 で初期化すると開始直後の 1 回目の解き直しでフェードが走り出す。`initialFadeState()` は `fromVolts === targetVolts` から始めるので、**▶ を押した瞬間に全回路が 0V から這い上がってくることも無い** —— 実機のコントローラは電源が入った時点で設定値を出している。

**打ち直すときの `fromVolts` は「前の目標」ではなく「今の実効電圧」。** 3V→8V の途中（5.5V）で 2V へ変え直したら 5.5V から向かうべきで、前の目標（3V）から始めても目標（8V）から落としても**画面の中で電圧が飛ぶ。**

#### 収束ループの外で 1 回だけ進める

```
simulate()
 ├ 収束ループの手前で fades を 1 回だけ進める   ← advanceFade()
 └ 反復の中では実効電圧を読むだけ                ← resolveAnalog(…, effectiveVolts)
```

**`previousTimers` とまったく同じ理由。** 反復のたびに進めると `changedAtMs` が毎回打ち直されて経過が常に 0 になり、電圧が動かない。目標（`channelVolts`）は 1 回の `simulate()` の中で変わらないので、ループの手前で決めきってよい。

`resolveAnalog()` へ渡すのは**「今この瞬間に何 V 出ているか」まで解いた結果**（`fadeKey()` → V）で、フェード時間そのものは渡さない。あちらはネットの上に電圧を重ねる第 2 パスで、時間の話を知る必要が無い（CLAUDE.md 設計原則 9）。`advanceFades()` は状態と電圧を一度に返す —— `evaluateRelays()` が励磁とタイマー状態を一度に返しているのと同じで、どちらも同じ 1 回の走査から出る。

引数は**省略可能**にしてある。停止中の配線チェック（`inspectWiring`）・役割配色（`wire-role.ts`）・経路確認モード（`path-preview.ts`）には時間が流れていないので、渡さなければ今までどおり目標値で解ける —— フェードのためにこの 3 つを書き換えずに済む。

#### 既定は 0 秒（フェードしない）

`FadeSpec.defaultFadeMs` を 0 にしてある。**保存済みの回路を開いた瞬間に挙動が変わってはいけない**ため、実機のフェード時間を定義に焼き付けず、プロパティパネルで秒を入れて初めてフェードする。この判断は機械的に検証できていて、**フェードを入れる前の 534 件は期待値を 1 つも書き換えずに通っている。**

`fade` を持たない `analog-source` は状態そのものを持たない（`fades` に読み手のいない項目を並べない）。`kind` を増やさないのはタイマー・調光ランプと同じ形（CLAUDE.md 設計原則 7）。

#### フェード時間は機器ごと、電圧は回路ごと

`CircuitComponentInstance.fadeMs`（§3.3）。**チャンネルごとに分けない** —— 実機のフェードはシーン全体にかかる設定で、回路ごとの値ではない。16 回路の機器で 16 個並べると、実機に無い設定があるように読める。上げと下げも共通の 1 つにしてある（分けるのは後からでも容易）。

`FadeState` のほうは**チャンネルごとに持つ**（`fadeKey()` = `componentId:channelId`）。時間は機器で 1 つだが、回路ごとに違う電圧を出している以上、どこまで動いたかは回路ごとに違う。

#### 本体に出す電圧も途中の値

`buildSimulationView()` が返す `channelVolts` は、**目標ではなく今出している電圧**（`result.fades` から導く）。ここで `channelVolts`（目標）を読むと、本体の数字だけが設定した瞬間に飛び、繋がった配線と負荷だけが遅れて動く —— **同じ 1 本の信号が 2 つの値で見える**ことになり、フェードしているのかどうかが読めない。

### 5.19 通信（操作卓 → コントローラ・`engine/communication.ts`）

**電気モデルに参加しない第 3 のパス。** ネットを組み終わった後に 1 回だけ走り、「どの機器のどのチャンネルが何 %」だけを返す（§4.17）。DSU にも `NetState` にも書き込まない。

```
simulate()
 ├ 入口の状態でネットを 1 度組む
 ├ resolveCommunication()  ← ここで 1 回だけ。返るのは componentId → channelId → %
 ├ advanceFades(…, communication.levels)
 └ 収束ループ（ネット → コイル / アナログ → 接点）
```

#### 収束ループの外で 1 回だけ解く

フェード（§5.18）とまったく同じ位置。**通信で決まるのは人が倒している値**で、1 回の `simulate()` の中では変わらない。反復のたびに解き直しても答えは同じで、ポートの総当たり（O(n²)）を 100 回まわすだけになる。

ただしネットが要るので、ループの手前で入口の状態のネットをもう 1 度組む。ここで組むネットは通信の相手探しにしか使わず、**ループが使うネットとは別物**（ループの中は接点が動くたびに組み直す）。

#### プロトコルは扱わない

フレーム・アドレス・ボーレート・応答時間は再現しない。運ぶのは「どの名前がいくつか」だけ。**このシミュレーターが読ませたいのは配線が正しいかどうか**で、通信の中身は機器の中の話（§6）。同じ理由で、通信の遅れも扱わない —— フェーダーを動かすと出力は同じ `simulate()` の中で動く。

#### 配線の不備は 3 つに分けて出す

| 不備 | 判定 | メッセージ |
|---|---|---|
| `half-wired` | ＋か−のどちらか一方しか共通のネットに来ていない | 「片側しか繋がっていません」 |
| `reversed` | ＋が相手の−へ、−が相手の＋へ来ている | 「＋と−が逆です」 |
| `common-mismatch` | 基準（GND）のネットが共通でない | 「基準を共有していないと成立しません」 |

**逆結線と基準の不一致は同時に出す。** どちらか 1 つに丸めると、片方だけ直して直らないという最も時間を溶かす状態になる。

**「繋ごうとしている」ことを先に読む。** `isLinked()` は＋・−のどちらか 1 本でもネットを共有していれば対と見なす —— 正しく繋がっていることを条件にすると、**配線ミスを指摘する相手が見つからない**（誰とも繋がっていない孤立したポートとして黙って通る）。

#### 停止中にも出す

`inspectWiring()`（§5.7）からも `resolveCommunication()` を呼び、▶ を押す前に通信線の不備が出る。**繋ぎ間違いは繋いだ瞬間に言うのが最も安い。** 配線チェックには時間が流れていないので、渡す `SimulationInput` は `AT_REST`（何も倒していない状態）でよい —— 不備の判定は倒した値を見ないため。

---


### 5.20 AC-DC 電源の電位生成

`computeNetStates()` は従来の `kind: "power"` と有向伝搬を解いたあと、`kind: "ac-dc-power-supply"` の L/N を確認する。同じ AC 電源 ID の両極が届いていれば、その AC-DC 電源自身の component ID を +V 側の `plusFrom` と -V 側の `zeroFrom` に追加する。一次側と二次側は union しないため絶縁は保つ。

経路グラフはエンジンが解いた `NetState` を読み、実際に二次出力が成立しているときだけ +V/-V を仮想電源ノードへ接続する。ラダー図は瞬時状態ではなく配線トポロジーを表すため、S8VM の +V/-V を DC 側の母線として扱う。

## 6. 既知の制約（MVP で許容する）

1. **ランプの直列接続は再現できない。** `+24V → L1 → L2 → 0V` では両方消灯になる（現実には両方が薄暗く点灯）。中間ネットがどちらの電源にも到達しないため。実務のリレー回路ではまず組まない配線であり、要件書 §30 の「電圧計算」フェーズで解決する。

   **コイルの直列は逆に実機と一致する。** `+24V → RY1 コイル → RY2 コイル → 0V` はどちらも非励磁と出るが、24V を 2 個の DC24V コイルで分け合っても吸引電圧に届かないので実機でも動かない。「負荷の直列は再現できない」と一括りにすると、合っている答えまで疑わせる。
2. **ダイオードは順逆の別と向きの誤りまで（§5.4）。** 導通の向き・還流ダイオードの向きの正誤・順方向短絡は再現するが、**逆起電力のサージそのものは再現しない**（時間の概念が無いため。下記 4 と同じ理由）。順電圧降下（約 0.7V）も扱わない。
3. **電圧・電流・消費電力の数値は扱わない（調光の 0–10V を除く）。** 電源まわりは導通の有無のみで、定格電圧の不一致（DC24V ランプに AC100V など）は MVP では検出しない。

   **例外は 0–10V の調光信号（§5.17）だけ。** これは導通レイヤに重ねた第 2 パスであり、`NetState`（どの電源の + / 0V に届くか）とは混ざらない —— 調光信号線を電源に繋いでも電圧は伝わらず、調光信号を 0V に落としても電源短絡にはならない。V → % の変換は定義側の `AnalogCurve` が持ち、エンジンは電圧しか読まない。

   **フェードは扱う（§5.18）。** 調光出力が出す 0–10V が、設定した時間をかけて目標値へ動く。時間の土台（`nowMs` を入力で受ける・実行時状態を返す・`nextEventAtMs`）はタイマー（§5.13）のものをそのまま使っており、**既定は 0 秒（フェードしない）** なので保存済みの回路の挙動は変わらない。

   **通信は「配線が正しいか」と「値が届くか」まで（§5.19）。** 操作卓のフェーダー・照明スイッチを倒すとコントローラの 0–10V が動き、＋−の逆結線・片側だけの配線・基準（GND）の不一致は警告に出る。**扱わないのはプロトコルのほう** —— フレーム・アドレス・ボーレート・応答時間は再現せず、運ぶのは「どの名前がいくつか」だけ。通信の遅れも無い（フェーダーを動かすと出力は同じ 1 回の解き直しで動く）。

   **調光で扱わないもの。** 位相制御（トライアック）・力率・消費電力の数値、出力段のインピーダンス（同じネットを複数の調光出力が駆動したら低いほうが勝つ、という 1 つの規則で近似する）、**受け側のソフトスタート**（時間をかけているのはコントローラだけで、調光器は来ている電圧に追従しているとみなす）。
4. **時間はタイマーの限時と調光のフェードだけ。** オンディレイ（限時動作）・オフディレイ（限時復帰・§5.13）と、調光出力のフェード（§5.18）は扱う。**扱わないのはそれ以外の時間** —— リレーの動作時間・復帰時間、接点が切り替わる途中の過渡、タイマーのフリッカ（周期）動作とワンショット。発振回路は「発振する」と判定するのみで、周期は再現しない。

   **チャタリングは「起きる配線かどうか」だけ判定する（§5.14）。** 自分の接点で自分のコイルを切っている配線は `coil-self-interrupt` として警告するが、**唸っている様子そのものは再現しない** —— ランプは点いたまま、`status` も `stable` のままになる。過渡を状態として持たない以上、実機の挙動を絵にすることはできない。警告が出た回路は、シミュレーターの表示が正しくても実機では唸ると読むこと。
5. **同時に変化する入力の競合は解けない。** すべてのコイルを一斉に評価するため、相互 b 接点のインターロック回路で全 OFF から 2 つの起動ボタンを同時に押した場合、実機のように「わずかに早い方が勝つ」のではなく `oscillating` になる（§5.5）。動作時間を持たない以上、どちらが勝つかを決める根拠が無い。
6. **範囲選択の配線判定は両端子を結ぶ直線で行う**（§8.6）。実際の描画は `smoothstep` の折れ線なので、大きく回り込んだ配線では見た目の線と判定線がずれる。実路を使うには描画後の DOM を測る必要があり、判定を純粋関数として検証できなくなる。
7. **ラダー図は「出せない配線」をそのまま言う（§5.16）。** 直列と並列だけでは表せない配線（ブリッジ回路）と、母線に届いていない配線は段にできないので、理由を出して諦める。**ダイオードは図に出さない** —— 還流ダイオードはコイルと並列に入る実装上の部品で、ラダー図の論理には現れないため（直列に入れた場合もその経路は数えない）。**調光（0–10V）も図に出さない** —— ラダー図は接点の論理を表す図で、アナログ量を描く場所が無い（§5.17）。生成は実体配線 → ラダー図の 1 方向だけで、逆変換は扱わない。
8. **`simulate()` は履歴を持たない純粋関数。** 自己保持のような双安定回路の状態は呼び出し側が `previousEnergizedRelays` で繋ぐ（§3.4）。渡し忘れると自己保持が毎回解けてしまうため、`simulationStore` 側で必ず前回結果を渡すこと。

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

**時計を回す条件は `nextEventAtMs` の有無 1 つだけ**（§5.13・§5.18）。カウント中のタイマーとフェード中の調光出力のどちらかがあるあいだ、固定の 50ms 間隔で解き直す。**離散（接点が変わる瞬間）と連続（フェード）を混ぜてよいのは、刻みをストアが決めているから** —— ここが読むのは「まだ動いているか」の 1 ビットで、フェードの途中の値は解き直しのたびにエンジンが出す。`previousTimers` と `previousFades` を毎回渡すのも必須で、渡し忘れるとタイマーの時間が進まず、調光出力の電圧が飛ぶ。

**`start()` は前回の結果を捨てる。** 残すと前回の励磁状態が `previousEnergizedRelays` として引き継がれ、押していない自己保持回路が最初から励磁した状態で立ち上がる。停止 → 開始が「電源を入れ直す」操作になるよう、`stop()` も `pressedSwitches` ごとクリアする。

**人が倒している盤の状態は 3 つとも同じ扱い。** `pressedSwitches`（押しボタン・切替スイッチ）・`operatedDevices`（機器の入り切り・§4.16）・`deviceLevels`（フェーダー・§4.17）はどれも保存せず、■ で停止するとまとめて初期化する。**リセット経路が 4 つある**（`start` / `stop` / 回路の入れ替え / 経路確認への切り替え）ので、1 つ足したら 4 つとも直すこと —— 1 箇所忘れると「停止したのにフェーダーが上がったまま」が残る。

**経路確認モード（`pathPreview`）もここに置く**（§8.14）。実行時状態なので保存対象ではなく、`running` との**排他をこのストア 1 箇所で守る** —— UI 側に条件を配ると、片方だけ直したときに両方の色が同時に載る。

---

## 8. UI 設計方針

- レイアウト: 3 カラム（左 240px / 中央 flex / 右 280px）＋ 上部操作バー。中心はあくまでキャンバス。**幅が 900px を切ったらキャンバス 1 枚＋下から出すシートへ畳む**（§8.12）
- トーン: クリーン・モダン・明るめ。余白を確保し、過剰な装飾はしない。古い CAD 風にはしない
- 端子: 半径 6px 以上を確保し、ホバーで 1.3 倍に拡大。配線ドラッグ中は接続可能な端子をハイライトし、接続不可の端子は減光する。指の端末では**当たり判定だけ**をさらに広げる（§8.12）
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
`visual.height` も併せて調整すること。** 現在値: スイッチ 4 種 160×200 / 電源
150×130 / ランプ 140×160 / ダイオード 140×190 / 端子台 200×170 / MY2N
210×220 / MY4N・MY4N-D2 260×240。

**高さは「状態によって出る行」も含めた最大構成で取る。** スイッチを 170 から 200 に
広げたのは、シミュレーション中に出る「回路から切離」（§5.12）の 1 行分を常に
確保するため。この行を出るときだけ足す作りだと、`.content` が上下中央寄せなので
本体全体が繰り上がり、**ON にした瞬間に操作ボタンが 14px ほど上へ逃げる。**
連打する部品でこれは押し間違えの原因になる。`SwitchBody` は行を出し入れせず
`visibility` で見せ消しし、操作ボタン自体も最長ラベル（"押下中"）で
`min-width` を固定して、ON / OFF で縁が伸縮しないようにしてある。

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

**a 接点のみのリレーは呼称ごと変える。** NC 端子を持たない接点（G7L・§4.8）では、
`ClosedSide` が `"nc"` ではなく `"open"`（どこにも閉じていない）を取り、パネルの
COM–NC 行は**そもそも描かない**。残る 1 行の見出しも「COM–NO」ではなく **「a接点」**、
接点の呼び名もカタログの数え方に合わせて「第1接点」ではなく **「第1極」**と出す。
「COM–NC 開」と出してしまうと、実機に無い b 接点と COM があるように読める。

**スイッチの導通は「同じネットに居るか」で読む。** 開閉の規則（A 接点は押下中だけ閉じる）
は `engine/graph.ts` の持ち物なので再実装しない。表示したいのは規則ではなく結果であり、
外部配線で短絡していれば「導通している」と出るのがむしろ正しい。

**カテゴリごとの表示は `ElectricalDefinition.kind` の 7 通りだけで分岐する。**
型番では分岐しない（CLAUDE.md 設計原則 2）。新型番を足してもパネルは変わらない。

**調光は同じ `lamp` の中で行を出し分ける（§5.17）。** 調光ランプ専用のセクションを作らず、
`dimming` を持つときだけ「調光入力」「明るさ」の 2 行を足す。見出しも
「ランプ」→「調光ランプ」に変わるだけ。**明るさは % と V を併記する** ——
V → % の対応はこの機器の性質（`AnalogCurve`）で、両方見せないと
「なぜこの明るさなのか」が読めない。調光出力（`analog-source`）だけは
セクションごと別で、出すのは V のみ。

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
調光信号が乗っている端子では、その下に**電圧（V）を説明本文より目立つ形で**足す
（§5.17）—— その端子について今いちばん知りたいのは何 V が来ているかで、
役割の説明はその次にくる。
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

#### レンズの色（Step 17 で追加）

**ランプを選んだときだけ**「レンズの色」の欄を出す（§4.11）。排他選択なので、独立したボタンではなく連結したセグメントで「どれか 1 つ」であることを見せる（範囲選択の対象と同じ・§8.6）。

**色見本と色名を必ず並べる。** 見本だけにすると、選ばれている色を目視の色だけで判断させることになる（要件書 §8）。見本の色は `bodies.module.css` と同じ値を使い、見本と実物がずれないようにする。

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

#### 中点で動かせない形は経路を自前で組む（`straightRunPath`）

**次の 2 つは、上の仕組みが何も動かせない。**

| 形 | `getSmoothStepPath` が描くもの | なぜ動かせないか |
|---|---|---|
| 向かい合っていて高さも同じ（右 → 左） | 直線 1 本 | 幹線の長さが 0。動かす対象そのものが無い |
| **向かい合っていない**（右 → 右、辺が直交） | 決まった高さをまっすぐ走り、そこから折れて相手の辺へ回り込む | そもそも中点を使わない |

とくに後者が効く。電源のレールと複数の負荷を結ぶ配線は「右辺 → 右辺」になりがちで、
**走行が全部同じ高さに立ち、ピクセル単位で完全に重なる。**

**走行が立つ高さは、引いた向きで変わる**（`runCoord`）。

| 引き方 | 出口は相手を | 走行の高さ |
|---|---|---|
| 電源 → 負荷（電源が左） | 向いている | **出口側**（電源の高さ） |
| 負荷 → 電源（電源が左） | 背を向けている | **相手側**（電源の高さ） |

どちらも走行は電源の高さに立つが、判定に使う端子が入れ替わる。**同じ 1 本の線でも
ユーザーがどちら向きにドラッグしたかで変わる**ので、片方だけを見ていると
「引き方によってレーンが配られたり配られなかったりする」ことになる。

ただし**向かい合ったまま回り込む形**（右 → 左で相手が左にいる）は別。これは
`getSmoothStepPath` が `centerY` を使う形なので、従来どおりの幹線として扱う。

重なりは色や太さの問題では済まない。後に描かれた 1 本しか見えないので、その下の線の
**電流の向きの切れ目（§5.10）も自己保持の破線（§5.9）も消え、「向きが無い線」に見える。**
本数すら数えられず、下の線はクリックもできない。

この 2 つは経路を自前で組み、**走行そのものを幹線とみなして直交方向へ逃がす。**

```
   ┌──────────────┐        ← レーンぶん逃げた走行
  ─┘              └─        ← 端子から真っ直ぐ出る 20px（HANDLE_GAP）
```

| 判断 | 理由 |
|---|---|
| レーン間隔は 16px（幹線の `LANE_STEP` は 10px） | 通電中の線は幅 3.5px に発光 4px が乗る。**10px では隣り合うレーンの光が触れて 1 本に見える。** 短い幹線なら前後の折れで区別が付くが、画面を横断する走行は延々と平行に並ぶぶん間隔だけが頼りになる。束の中に幹線と走行が混ざるときは**広いほうに揃える**（別々の間隔で振ると別のレーンどうしが近い位置に落ちる） |
| 逃がす上限は ±32px（±2 レーン＝ 5 本） | 経路が破綻する限界は無いが、離しすぎると線が部品の並びから浮き、どの端子から出ているのか読めなくなる |
| 走行長が 24px 未満なら曲げない | 迂回の折れ 2 つが収まらない。無理に曲げると重なり以上に読みにくい |
| 角の丸めは React Flow の `getBend` と同じ規則 | 半径の決め方まで揃えないと、自前の経路の角だけ違う丸みになって浮く |
| **向かい合ったまま回り込む形は対象外** | `centerY` で動かせるので、従来の幹線として扱えば足りる |
| `trunkOf` と `straightRunPath` で**同じ条件を二度書く** | レーンを決める側（部品の位置＋端子の相対座標）と描く側（React Flow が測った Handle の座標）で入力が違う。片方だけが該当と判断すると、**レーンは配られたのに線は元のまま**になる。対象外なら `null` を返して smoothstep に戻す |

`straightRunPath` は `@xyflow/react` に実行時依存を持たない（node 環境の Vitest で検証する）ため、
辺は React Flow の `Position` ではなく `TerminalSide` で受ける。変換は `WireEdge` の仕事。

#### 部品の本体を跨がない（Step 17 で追加）

**線が部品の上を通ると、線と型番・端子番号のどちらも読めなくなる。** とくに困るのが 2 つ。

| 形 | 何が起きるか |
|---|---|
| 同じ部品の上辺と下辺を結ぶ線 | 両端の座標が揃うので `getSmoothStepPath` が**直線**を返し、本体を真っ直ぐ縦断する |
| 電源と負荷の間に部品が挟まっている | 走行が挟まった部品の本体を横切る |

やることは 1 つだけ —— **幹線・走行が部品の矩形に入っているなら、いちばん近い外側へ逃がす。**

| 判断 | 理由 |
|---|---|
| 当たり判定は**矩形そのもの**（余白を足さない） | 余白まで含めて当たりとすると、脇を数 px 離れて走っているだけの線まで動く。混んでもいない場所の線が図面から浮く |
| 逃がす先は**本体から 16px**（`COMPONENT_CLEARANCE`） | `HANDLE_GAP`（20px）より小さく取る。端子から出る助走と同じ位置に立てると、助走の折れ目と迂回の直線が重なって 1 本に見える |
| 逃がす向きは**素の位置から見て近いほう** | `base`（レーンのずらし量を足した位置）で決めると、レーン 1 本ぶんの差で反対側へ飛ぶ線が出て束が左右に割れる |
| 逃がしたあと**レーン番号ぶん外へ積む** | 同じ部品を避ける配線が複数あると、全部が本体のすぐ外の同じ位置へ寄って重なりが戻る |
| 上限は ±320px（`MAX_DETOUR`） | いちばん大きい部品（MY4N は 260×240）を回り込める幅。**超えるなら避けずに諦める** —— それ以上引き回すと、どの端子から出た線か追えなくなり、跨いでいるより読みにくい |
| **重なりを解いたあとに掛ける** | 順序が逆だと、避けて決めた位置をレーンのずらし量が上書きして本体の上へ戻す |

**動かせる幅は形で決まる。**

| 形 | 上限（`Trunk.detour`） |
|---|---|
| 相手を向いて出る（幹線が両端の間に立つ） | `room` と同じ。ここから出すと経路が折り返す |
| **相手に背を向けて出る（回り込み）** | `MAX_DETOUR`。幹線は両端の外を通る迂回線そのもので、どこへ置いても形が崩れない |
| 自前で組む走行（`straightRunPath`） | `MAX_DETOUR`。ただし走行が `MIN_JOG_RUN` 未満なら 0（迂回の折れが収まらない） |

2 行目が要点。**両端の座標が揃うと `room` は 0 になる**（`|Δ|/2` が 0）が、これは動かす幅が無いのではなく**いちばん動かす必要がある配置** —— 同じ部品の上辺と下辺を結ぶ線がまさにこれで、`room` をそのまま上限にすると永久に本体を突っ切ったままになる。

**これは §8.7 冒頭の「絶対に重ならないは採らない」を捨てたわけではない。** 避けるのは**部品だけ**で、配線どうしの交差は今までどおりレーン分離と強調（下記）で扱う。部品の位置に応じて経路が変わる副作用はあるが、本体を突っ切る線はそれ以前に読めない。

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

#### 重ね順 —— 隠されると情報が消える線ほど前面へ

交差そのものは無くせない。そこで**重ねる順序に意味を持たせる**（`CircuitCanvas` の `WIRE_Z`）。

| z | 線 | 隠されると何が消えるか |
|---|---|---|
| 4 | 電源短絡 | 最も危険な配線ミスそのもの |
| 3 | 電流の向き（§5.10）・自己保持（§5.9）・配線漏れ（§5.8）の破線 | **模様が意味を持つ線。** 実線に覆われると「向きが分からない」ではなく「向きが無い」に見える |
| 2 | 通電中（向きを持たない枝） | 生きている閉回路 |
| 0 | 待機線・役割色 | —— |

これは §5.6 の判定順（最も危険な配線ミスを最も安全な見た目にしない）を描画順へ延長したもの。
色の判定順だけを正しくしても、その線が別の線の下に沈んでいれば同じことが起きる。

ホバー（2000）と選択（React Flow の `elevateEdgesOnSelect`・+1000）はこれより常に上。
掴んでいる 1 本は、どんな状態の線より手前に出す。

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

**狙った基準へ揃えたいときは §8.13（操作バーの「揃える」）。** ここでやるのは
「揃っているつもりのものを揃える」までで、`ALIGN_TOLERANCE` を超えて離れた部品は
動かない。

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

### 8.11 リレーの接点の図記号（`RelayBody`・Step 11 で確定）

これまでノードに描いていたのはコイル枠だけで、**リレーの本体である「COM が NC から NO へ移る」という動きが絵として出ていなかった。** どの接点が切り替わったかは端子と配線の色で読めるが、それは色を読める人にとっての話であり、「リレーとは何が起きる部品なのか」を初めて知る人には届かない。

コイル記号の下に、接点 1 極につき 1 枚の図記号を並べる。

| 要素 | 描き方 |
|---|---|
| COM | 左の支点（塗った丸）。番号を上に添える |
| NC | 右上の固定接点。番号を右上に添える。**`ncTerminal` を持たない接点では描かない**（§4.8） |
| NO | 右下の固定接点。番号を右下に添える |
| 可動片 | 支点から閉じている側へ。閉じている側は通電色（`SwitchBody` と同じ扱い） |
| a 接点で非励磁 | 固定接点に届かない中途半端な角度。**上へ倒して NC のように描かない** |

**端子番号を図記号に添える。** 番号の無い抽象的な接点記号は、外周に並ぶ実端子番号と結び付かないので初めて読む人には繋がらない。「9 番の COM が 1 番から 5 番へ移る」という動きこそがリレーそのもので、それが本プロダクトの価値（CLAUDE.md）と一致する。

どちら側が閉じているかは `adapter/inspection.ts` の `inspectContacts()` を呼ぶ。ここで `energized ? "no" : "nc"` と書くと、エンジンが持っている開閉規則（`closedContactPairs`）の**3 つ目の写し**ができる。

**停止中は静止状態（非励磁）の絵を描く。** これは「消磁している」という状態の主張ではなく、机の上に置いたリレーがそう見えるという事実であり、`SwitchBody` が停止中も b 接点を閉じて描くのと同じ扱い。§8.2 の「停止中は状態を出さない」に反しない。

**左右反転（§8.1）では鏡像にしない。** 端子番号という文字を含む図なので、反転すると番号が読めなくなる（`bodies.module.css` がキャプションを反転させないのと同じ理由）。図記号の向きが部品と揃わなくなるが、**読めない番号よりは揃わない向きのほうがまし。** そのため `.symbol` ではなく専用の `.contactDiagram` クラスを使う。

### 8.12 モバイル表示（`useViewportMode.ts` + `place-component.ts`・Step 13 で確定）

**デスクトップの画面には手を入れない。** 3 カラム（§8）はマウスとキーボードのための形で、そこを崩さずに、狭い画面と指の端末でだけ別の形を出す。

#### 判定の軸は 2 つある

「モバイルか」という 1 つのフラグに畳まない。変える理由がまったく別だから。

| 軸 | 判定 | 変わるもの |
|---|---|---|
| **狭さ** | `(max-width: 900px)`（`useCompactLayout`） | 3 カラム → キャンバス＋下から出るシート。操作バーの名前を短縮。凡例を畳む |
| **指** | `(pointer: coarse)`（`useCoarsePointer`） | 1 本指ドラッグ＝画面移動。パレットはタップで置く。当たり判定を広げる |

狭いデスクトップの窓（マウス）と、広いタブレット（指）は別物で、片方だけが立つ。1 つに畳むと、タブレットで「左のパレットからドラッグ」と案内して**そのとおりにしても何も起きない**画面ができる。

900px は 3 カラムの下限から決めた —— 左 240px ＋ 右 280px を引いてキャンバスに残るのが 380px を切ると、部品 1 個（MY4N で 260px）を置いて配線を追う余地が無くなる。

**判定は `useViewportMode.ts` の 1 箇所だけが持つ。** 狭いときの見た目は根に付けた `data-compact` 属性で切り替え、**CSS 側にブレークポイントの数値を書き写さない。** 同じ数値を 2 箇所に持つと、片方だけ直したときに「シートは出ているのに 3 カラムのまま」という食い違いが起きる。ホバーの有無（`pointer: coarse`）は端末の性質でレイアウトの都合ではないので、当たり判定まわりの CSS は素直にメディアクエリで書く。

初期値は必ず `false`（デスクトップ）。静的書き出し（§9.1）した HTML には画面が無く、`window.matchMedia` はサーバー側で読めないので、初回描画をデスクトップに固定してマウント後の効果で切り替える。

#### 狭い画面 —— 畳むのはパネル、削るのは名前だけ

キャンバスを 1 枚に広げ、両脇のカラムは画面下のタブから開くシートに畳む（部品 / プロパティ / 診断）。

- **シートはキャンバスを押し上げず、上に重ねる。** 開くたびに図面が縮んでスクロール位置が変わると、部品を置いた場所を見失う
- **中身は 3 カラムと同じコンポーネントをそのまま入れる。** モバイル用のパネルを別に作ると、片方だけ直す事故が起きる。カラムの境界線だけをシート側の CSS で落とす
- **畳んだパネルは描かない。** 表示だけ消して残すと、プロパティと診断がキャンバスの裏で解き続ける
- **タブに数を出す。** 3 カラムなら常に目に入っている「選択中の部品」と「指摘の件数」が、シートを閉じている間はまったく見えなくなる。短絡を出したまま気付かずに配線を続ける状態を作らない。件数のためにタブ側でも `useWiringCheck()` を呼ぶ（`WarningList` と二重に解くが、狭い画面でシートを開けている間だけの重複で、`inspectWiring` は端子数に線形）

操作バーは**折り返す。横スクロールにしない。** 1 行に押し込んで横へ流すと、はみ出した書き出し・読み込みが「無い機能」になる。名前は短くする（`▶ シミュレーション開始` → `▶ 開始`）が、**ボタンの数は減らさない** —— モバイルには Delete キーも L キーも無いので、ここから消した操作は二度と辿り着けない。落とすのは 3 つだけ。

| 落とすもの | 理由 |
|---|---|
| アプリ名 | 操作に要らない唯一の要素 |
| 範囲選択の対象切り替え | 指では枠そのものを引けない（下記）。設定しても効く場面が無い |
| 「保存済み」の表示 | 自動保存が効いている間は黙ってよい。**保存できない環境の表示は残す** —— 黙るとリロードで回路が消えて初めて気付く（§8.4） |

#### 指 —— ドラッグの割り当てが変わる

**1 本指のドラッグは画面移動。** マウスでは素の左ドラッグを範囲選択に取っているが（§8.6）、指には Shift も中ボタンも無く、そのままでは図面をまったく動かせない。拡大・縮小は 2 本指（`zoomOnPinch`）。範囲選択は指では使えなくなるので、対象切り替えも隠す。

**パレットはタップで置く。** HTML5 の D&D（`dragstart` / `drop`）はマウス専用で、指では摘まむ操作がそのまま死ぬ。`ComponentPalette` に `onPick` を渡すと、掴める `<div>` ではなく押せる `<button>` の一覧になる —— 掴めるように見えて動かない要素を出さない。

置き場所の計算は `place-component.ts` の純粋関数に閉じる（React も React Flow も import しない。§1 の考え方を表示側にも通す）。

| 関数 | すること | 外すと何が起きるか |
|---|---|---|
| `placeAtViewportCenter()` | いま見えている範囲の中央へ置く。グリッド（§8.9）へ吸着し、**既存の部品と矩形が重なる間は右下へずらす** | 落とす位置を選べないので、続けて置いた部品が完全に重なり「1 個しか置けていない」ように見える。重なりを左上の座標だけで見るとリレーの上に電源が乗る |
| `panToInclude()` | ずらした先が画面から出ていたら、はみ出したぶんだけ画面を寄せる（倍率は変えない） | 携帯の幅ではリレー 1 個で画面の 3 分の 2。ずらした部品はすぐ枠の外へ出て、**タップしたのに何も起きていないように見える** |

収まっているなら `panToInclude()` は同じ変換を返す。呼び出し側はそれを見て動かさない —— 置くたびに図面がわずかに揺れると、どこを見ていたのか見失う。

**そもそも収まらない軸は動かさない。** 横向きの携帯（キャンバスの高さ 244px）に MY4N（230px ＋端子ラベル）を置くと、どう寄せても全体は見えない。片側へ寄せると逆側が余分に切れたうえ図面まで動くので、中央に置いたまま上下（左右）を均等に切れさせる。縮めるのはピンチと `全体` に任せる。

#### 横向き（landscape）

**縦向きより厳しいのは高さ。** iPhone を横にすると 750×342 ほどで、操作バー（49px・1 行に収まる）と画面下のタブ（49px）を引くとキャンバスは 244px しか残らない。ここで効かせている手当ては 3 つ。

| 事象 | 手当て |
|---|---|
| シートの中身が 1 件しか見えない | **見出しの帯を作らず、閉じるボタンを右上へ重ねる。** 中身のパネルは自分の見出しを持っているので、シート側で繰り返す理由も無い。加えて `@media (max-height: 520px)` でシートの割合を 58dvh → 78dvh へ上げる（高さの条件なので幅の `data-compact` とは別の軸で、CSS だけで完結する） |
| 切り欠き（ノッチ）が左右に来る | `viewportFit: "cover"` で端まで使っているので、`env(safe-area-inset-left / right)` を `.workspace` に足す。**入れないと横向きで ▶ 開始・いちばん左のタブ・ズームボタンが切り欠きの下に潜る。** 縦向きでは両方 0 なので、この指定は横向きでだけ効く |
| 部品がキャンバスの高さに収まらない | 上記のとおり `panToInclude()` は収まらない軸を動かさない |

#### 当たり判定は広げる。見た目は広げない

| 対象 | 広げ方 |
|---|---|
| 端子 | `.handle::after` の `inset` を −6px → −12px（およそ 36px 角） |
| 押しボタン | ボタンの箱ではなく透明な `::after` で上下左右へ。**箱を高くしない** —— ノードの高さは `visual`（スイッチは 200px）で決まっており、`.content` が `overflow: hidden` なので「回路から切離」の行が切り取られる |
| 操作バー・ズーム | ボタンの最小高さ 36px、React Flow の `Controls` は 32px 角 |
| 端子の吸着 | `connectionRadius` を 20 → 32px。指先の当たり判定に端子が複数入るので、既定では狙った端子の手前で線が離れる |

**端子の点そのものは大きくしない。** MY4N のように 14 個並ぶ部品では点どうしがくっついて実端子番号が読めなくなる —— それは本プロダクトが最優先で読ませたいもの（CLAUDE.md）。

#### 画面全体（`layout.tsx` / `globals.css`）

- `viewport: { width: "device-width", initialScale: 1, viewportFit: "cover" }`。**拡大は禁止しない** —— `maximumScale: 1` は端子番号を読むためのピンチまで奪う
- `overscroll-behavior: none` —— キャンバスを下へ払う操作がページの再読み込み（pull-to-refresh）に取られると、組みかけの回路が消えたように見える
- `-webkit-text-size-adjust: 100%` —— 横向きにしたとき Safari が本文だけ太らせて、図面との対応が崩れるのを止める
- 入力欄（パレット検索・部品名・タイマーの秒数）は `pointer: coarse` で 16px 以上。iOS Safari は 16px 未満の入力欄にフォーカスすると**ページごと拡大**し、戻す手段がピンチしかない
- 画面下のタブは `env(safe-area-inset-bottom)` を足す。入れないとホームインジケーターに重なって押せない

#### ヘルプに書く

キーとマウスの表（§8.10）だけでは足りない。指では割り当てが変わり、**Delete キーが無いので削除の唯一の経路が操作バーのボタンになる。** `SHORTCUT_GROUPS` に「タッチ操作」の群を足して、置き方・画面の動かし方・削除の経路を載せる。

---

### 8.13 選択した部品を揃える（`adapter/align.ts` + `align-components.ts`・Step 14 で確定）

§8.9 の自動整理は「**描いた並びを崩さずに整える**」もので、`ALIGN_TOLERANCE`（32px）を
超えて離れた部品は揃わない。そのため「この 3 個だけきっちり左端を合わせる」「この列を
等間隔にする」ができない。制御盤の図面は列を作って描くので、**狙った部品を狙った基準へ
動かす**操作を別に置く。

#### 自動整理とは別の操作にする

| | 自動整理（§8.9・L キー） | 揃える（§8.13・操作バー） |
|---|---|---|
| 何をするか | 描いた並びを保ったまま整える | 指定した基準へ意図的に動かす |
| 対象 | 選択中があればそれだけ、無ければ**全体** | **選択中だけ**（空なら何もしない） |
| グリッド吸着 | する | しない |
| 重なりの解消 | する（下へ逃がす） | **しない** |

**同じボタンに混ぜない。** 混ぜると L を押すたびに列が潰れる。逆に、揃えた結果 重なった
ものをほどきたければ L を押す —— 役割を分けてあるので両方が意味を持つ。

#### 8 種類（`AlignMode`）

| モード | 基準 | 動かさない部品 |
|---|---|---|
| `left` / `right` | 選択の外接矩形の左端 / 右端 | いちばん左 / 右の部品 |
| `top` / `bottom` | 外接矩形の上端 / 下端 | いちばん上 / 下の部品 |
| `center-x` / `center-y` | 外接矩形の中心へ**各部品の中心**を合わせる | （幅・高さが違えば全部動く） |
| `distribute-x` / `distribute-y` | **部品の中心**が等間隔になるよう配る | 中心が両端の 2 個 |

#### 均等は「中心を等間隔に」

隙間を等しくする流儀もあるが、**中心の等間隔**を採る。中心が等間隔なら部品の幅が
変わっても**列のピッチが一定に保たれ**、ラダー図の列として読める。中心座標でソートし、
最小・最大の 2 個を固定してその間を `n-1` 等分する。左上座標は `round(center - size / 2)`。

並べ替えの比較で中心が同じときは **ID で決める。** 入力順に依存させると、同じ操作を
2 回押して結果が変わる。

#### グリッドへは吸着しない

吸着すると「いちばん左の部品に揃えたのに、その部品まで動く」ことになり、**何を基準に
揃ったのかが読めなくなる。** 整数へ丸めるだけに留める（先に自動整理を掛けてあれば
結果はグリッドに乗る）。

#### 必要な選択数（`minimumSelection`）

| 操作 | 最小 | 理由 |
|---|---|---|
| 揃える（6 種） | 2 個 | 1 個では「何に揃えるのか」が無い |
| 均等（2 種） | 3 個 | 2 個では間隔が 1 つしか無く、両端は動かさないので必ず元のまま |

満たさないときは純粋関数が**空の Map** を返し、UI 側でもボタンを `disabled` にする。
`targetIds` は**必須引数**にしてある —— 自動整理と同じく省略で全体に効かせると、
図面全部が 1 本の線に潰れる。

#### 履歴は 1 手・呼び出し口は 1 本

`circuitStore.applyLayout(positions)` へ渡す（§8.9 と同じ）。動く部品だけを返し、既に
揃っていれば空の Map で空振りの 1 手を積まない。`align-components.ts` は `auto-arrange.ts`
と同じ形で、ストアは購読せず `getState()` でその場で読む。判定は `adapter/align.ts` の
純粋関数（React も `@xyflow/react` も import しない）。

#### ショートカットキーは割り当てない

無修飾キーは D（削除）/ F（反転）/ L（整列）/ S（実行）で埋まっており、8 種類に充てられる
残りが無い。**`Ctrl` 併用はブラウザに取られる**（§8.9 で L について既述）。操作バーの
メニューからのみ到達させ、`SHORTCUT_GROUPS` には「操作バーの「揃える」」として載せる。

#### メニューにする（`Toolbar`）

8 個を操作バーへ直接並べると、狭い画面で折り返しが増えてキャンバスが削られる（§8.12）。
ボタン 1 個に畳み、押したときだけ 2 列 × 4 行で開く。**列は軸で分ける** ——
左列が左右方向（左 / 左右中央 / 右 / 左右に均等）、右列が上下方向。行方向に流すと
「左揃え」の隣に「上揃え」が並び、どの軸の操作なのかが読み取れなくなる。

- **`<dialog>` にはしない。** ヘルプ（§8.10）と違い**選択を保ったまま押せること自体が要件**で、
  モーダルにするとフォーカスが移って「何を選んでいるか」が画面から消える
- 閉じる契機は「項目を選んだ」「Esc」「外側のクリック」「選択が 2 個未満になった」
- **メニュー上の `keydown` は `stopPropagation()` する。** しないと、項目にフォーカスがある
  状態で D を押すと選択が削除される（ショートカットは `window` で拾っており、React は
  ルート要素で受けるのでそこで止まる）
- 狭い画面ではメニューを右寄せで開き、`max-width` を画面幅に切る（§8.12）

### 8.14 経路確認モード（`usePathPreview` + `PathPreviewList`・Step 15 で確定）

**動かす前に経路を読むための専用モード。** 操作バーの `⚡ 経路確認` で入り、静止状態の到達範囲（§5.15）をキャンバスに塗る。▶ の隣に置くのは、「動かす前に読む」操作が動かす操作と同じ場所に無いと存在に気付けないため。

#### ▶ とは排他にする

同時に立てられると、同じ線に「今流れている」と「電源を入れれば流れる」の 2 つの意味が同時に載る。排他は `simulationStore` の 1 箇所で守る（`start()` が `pathPreview` を落とし、`togglePathPreview()` が `running` を落とす）。

**「実行中は押せない」にはしない。** 動かしたまま配線を読み直したくなったときに ■ を先に押させることになり、ボタンが 2 度手間になる。止まるという結果は同じなので、押した側が勝つ。

#### 予測であることを色ではなく描き方で表す

| | 実行中 | 経路確認中 |
|---|---|---|
| + 側 / 0V | 赤 / 青の実線（薄く） | **同じ赤 / 青の破線**（濃さは戻す） |
| 通電（励磁・点灯） | 緑の太い実線＋発光 | **緑の太い破線・発光なし** |
| 届いていない | 灰（薄く） | 灰（薄く・実線のまま） |
| 部品そのもの | 励磁・点灯・押下を表示 | **何も表示しない**（動いていない） |

色相を変えないのは、「+ 側が来ている」の意味が動かしていても止まっていても同じだから。色まで変えると読み手は 2 つの語彙を覚えることになる。逆に**発光は必ず落とす** —— 光っている線は「今まさに流れている」と読まれ、電源を入れればこうなるという話をしている画面でそれは嘘になる。

実装は `.canvas[data-path-preview]` の 1 段だけで、Edge に載るクラスは実行中と同じ（`CircuitCanvas.module.css`）。端子側は別の CSS Modules にいるので祖先の属性で引く（`DeviceTerminal.module.css`）。**どちらか片方だけ直すと端子だけが光って線と食い違う。**

**役割配色（§5.8）とも排他。** 4 色＋4 色が同時に載ると、どちらの軸で読めばよいのかが線から分からなくなる。凡例（`WireLegend`）も 3 通りを切り替える。

#### スイッチは倒せる（Step 16 で追加）

このモードで**スイッチの操作子を出す。** 実機を配線する前の確認は「S1 を入れたらどこまで電気が来るか」を指でなぞる作業で、倒せないと静止状態 1 枚しか読めない。倒せる／倒せないの線は §5.15（人が決めることは入力、回路が決めることは ▶）。

| | 出る場所 | 見た目 |
|---|---|---|
| 実行中 | すべてのスイッチ | 実線の枠、押下中は `--accent` のべた塗り |
| 経路確認中 | すべてのスイッチ | **破線の枠**、倒している間は薄い塗り（`--accent-tint`） |
| 停止中 | 出さない | —— |

**塗りを弱くするのは配線と同じ約束。** 実行中と同じべた塗りにすると、電源を入れていないのに「今この状態で動いている」と読まれる。破線であることが「まだ ▶ を押していない」の合図になるので、`data-pressed` より後に `data-preview` の指定を置いて必ず勝たせる。

倒した状態は `simulationStore.pressedSwitches` に入る —— **実行中と同じ 1 つを使う。** 2 つ持つと「▶ で押した状態」と「経路確認で倒した状態」がずれ、モードを行き来したときにどちらが効いているのか読めなくなる。代わりに**モードの出入りで必ず空へ戻す**（入るときも出るときも）。残すと、停止中の役割配色に戻ったあとも見えない操作が効いたままになる。

ノードへは `DeviceNodeData.preview`（`{ blocked, operated }`）で渡す。**`simulation` には混ぜない** —— あちらの有無が「シミュレーション中か」の唯一の合図（§8.1）で、混ぜると部品が動いているように見える。`preview` の有無が経路確認中かの合図になり、`SwitchBody` はそれを見て操作子を出す。**これを読むボディはスイッチだけ**で、他の部品はこのモードで動かないので使い道が無い。

#### リレーが動かないことを一覧の先頭で言う

スイッチが倒せる以上、読み手は「押した先」を見ているつもりになる。**コイルが励磁色になってもその接点は開いたまま**なので、黙っていると自己保持もインターロックも壊れているように見える。`PathPreviewList` の注記でそれを先に言い、この 1 文だけは本文の色で出す（注記全体が薄いので、いちばん誤解を生む文まで薄いと読み飛ばされる）。

止まっている箇所の文言も操作状態で変える。**開いている理由は接点の種別ではなく、いま倒しているかで決まる** —— a 接点は倒していないから開いており、b 接点は倒したから開いている。種別だけを見て「操作すると閉じます」と出すと、既に倒している b 接点に向かって「もっと倒せ」と言うことになる。

#### 止まっている箇所は一覧で出す

キャンバスでは、電位が止まっている部品を**黄の点線の輪郭**で囲む（`data-preview-blocked`）。選択と励磁が既に実線の枠を使っているので、3 つ目の実線は足さない。

輪郭だけでは「どの端子とどの端子の間で止まっているか」は読めない —— 開いている接点はそもそも線が描かれていない。右カラムの `PathPreviewList` が端子番号でそれを言う（`+ 側 | RY1 9 → 5 | このリレーが動作すると閉じます`）。押すとその部品を選択する。

一覧には必ず**いま何を見ているのかを添える。** ここに出ている励磁を「ボタンを押した後の姿」と読まれると、押して初めて動く回路が壊れているように見える（§8.4 の配線チェックと同じ約束）。狭い画面では診断と同じシートに入れる —— どちらも「回路を読む」ための一覧で、タブを増やすほどの別物ではない（§8.12）。

#### 解くのは 1 箇所

キャンバス（色）・一覧（文言）・プロパティパネル（端子の電位）が `usePathPreview` の同じ結果を読む。別々に解くと、画面で止まっている場所と一覧に並ぶ場所が食い違う（`useWiringCheck` と同じ役割分担）。

プロパティパネルは**端子の電位だけ**を埋める。接点の倒れている側と部品の状態は埋めない —— 静止状態＝どのリレーも励磁していない状態なので接点は定義どおりで、ここに値を入れるとパネルが「動いている」と言い始める。

#### ショートカットキーは割り当てない

無修飾キーは D / F / L / S で埋まっており（§8.10）、残りを充てると既存の割り当てとぶつかる。ヘルプには操作バーの項目として載せる。

---

### 8.15 ラダー図（`LadderDialog`・Step 18 で確定）

操作バーの `⊞ ラダー図` で開くモーダル。変換も文面も持たず、`adapter/ladder.ts` の結果を描くだけ（`WarningList` / `PathPreviewList` と同じ約束）。

#### 「読む」操作の並びに置く

▶ ・`⚡ 経路確認` と同じグループに置く。どれも**動かす前に回路を読む**ための操作で、配置や書き出しの隣にあると図面の編集操作に見える。部品が 1 個も無いときは段が 1 本も出ないので押せない。

#### ヘルプと同じモーダル

`<dialog>` を `showModal()` で開き、開いている間は打鍵をキャンバスへ通さない（`HelpDialog` と同じ理由 —— D / F / L は無修飾 1 打鍵で回路を変える）。閉じている間は図を組まない。ショートカットキーは割り当てない（無修飾キーは D / F / L / S で埋まっている・§8.10）。

#### 端子番号を落とさない

接点と出力の下に必ず実端子番号（`9-5`）を添える。**ここを落とすと一般的なラダー図と変わらなくなり**、キャンバスの配線と照らせなくなる。限時接点は図記号だけでは読み取れないので「限時動作 / 限時復帰」の札を添える（§5.13）。

#### 骨組みは CSS が引く

横線は行の擬似要素が引き、図記号（SVG）が**自分の下地で線を隠して切れ目を作る。** 図記号に下地を持たせないと横線が接点の内側を突き抜け、開いている接点が閉じて見える。線を SVG で 1 本ずつ引かないのは、段の幅が中身（接点の枚数と呼び名の長さ）で決まるため —— 座標を計算して描くと、部品名を変えるたびに図が崩れる。図記号の中心は上から 30px に揃えてあり、横線・並列の縦線・段番号の位置はすべてこの 1 つの数から出ている。

母線は各段の枠線（`border-left` / `border-right`）を縦に積んで 1 本に見せている。**段と段の間を空けない** —— 空けると母線が切れる。

#### 図を保存しない

ラダー図は配線から毎回組み直せる派生物なので、`CircuitDocument` にも履歴にも持たない。持つと配線と食い違ったまま残る。読むためのものであり、ここを編集しても配線は変わらないことを本文で断る。

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
| 13 | モバイル表示（狭い画面のシート＋タッチ操作） | 携帯の幅で 3 カラムが畳まれ、パレットのタップで部品を置け、1 本指で画面を動かせる。デスクトップの見た目と操作は変わらない（§8.12） |
| 14 | 選択した部品を揃える（左右上下・中央・均等） | 2 個以上選んで揃えると基準にした端の部品は動かず、3 個以上で中心が等間隔に並ぶ。どれも Undo 1 回で戻る（§8.13） |
| 15 | 経路確認モード（動かす前に電位の届く範囲を読む） | ▶ を押さずに、電源から電位が届いている線が破線で塗られ、止まっている接点が端子番号で一覧に出る。▶ とは排他で、収束ループは回らない（§5.15・§8.14） |
| 16 | 経路確認モードでスイッチを倒す | 経路確認中にスイッチを操作でき、倒した先の到達範囲と一覧が即座に追随する。**リレーの接点は動かない**ので収束ループは回らないまま（§5.15・§8.14） |
| 17 | 配線が部品を跨がない／表示ランプの色 | 幹線・走行が部品の本体に入らず外を回り、同じ部品の上下端子を結ぶ線も本体を縦断しない。表示ランプは黄・赤・緑・青・白のレンズを選べ、消灯中も色が読める（§4.11・§8.7） |
| 18 | ラダー図への変換（実体配線 → ラダー図） | 自己保持回路が「起動ボタンと保持接点の並列」として 1 段に出て、接点の下に実端子番号が残る。出せない配線（ブリッジ・母線に届いていない）は理由を出す（§5.16・§8.15） |
| 19 | 電磁接触器と AC 電源 | 主接点 3 極＋補助 1a1b の接触器を AC100V で動かせ、補助 b 接点（21–22）が励磁するとどこにも閉じない。**`src/circuit/engine/` の差分 0 行**（§4.12・§4.13） |
| 20 | 調光（0–10V のアナログ量） | 調光出力とランプを繋ぐと明るさが出て、**0V で 100%・10V で 0%**。信号線の挿し忘れが「出力は 100% になります」と停止中に出る。接点で 0V へ落とすと全灯し、それが電源短絡として警告されない。0V の調光線が非通電（灰）に見えない（§4.14・§5.17） |
| 21 | 実機の調光システムの機器 | 46 端子の調光コントローラで 16 回路を配れ、位相制御調光器で AC の負荷を調光できる。極性・上下限・カーブを盤ごとに設定できる（§4.15） |
| 22 | 接点の駆動源を広げる | カットリレーが明るさで動き、操作卓のボタンで無電圧接点とオープンコレクタ出力が倒れる。コイルの無い機器で既存の判定が壊れない（§4.16） |
| 23 | 調光のフェード（時間をかけた明るさの変化） | 調光出力のフェード時間を秒で設定すると 0–10V が目標値へ時間をかけて動き、配線の V ラベル・ランプの明るさ・本体の数字が同じ 1 つの値で滑らかに動く。DIRECT は瞬時のままで、フェード中にカットリレーが動作点をまたぐ。**既定 0 秒のため Step 22 時点の 534 件が期待値の書き換えなしに通る**（§5.18） |
| 24 | 操作卓の通信でコントローラの出力を動かす | 操作卓のフェーダーを上げると通信線の先の調光コントローラの 0–10V が動き、照明スイッチが入り切りで効く。通信線の＋−の逆結線・片側だけの配線・基準（GND）の不一致が停止中の配線チェックに出る。通信線を繋がなければコントローラは自分の設定値を出したまま。**Step 23 時点の 575 件が期待値の書き換えなしに通る**（§4.17・§5.19） |

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

#### 配布経路はこの 1 本だけ（Step 22 の後で確定）

**Cloudflare 側の Workers Builds（ダッシュボードで GitHub と直結する仕組み）は使わない。** 一度これが有効になっていて、同じ push で 2 つの経路が同じ Worker を書きに行く状態になっていた。

2 本あると次の 3 つが同時に壊れる。

1. **競合する。** 同じ push で 2 つが同時に配布し、あとから入ったほうが勝つ
2. **どの版がどのコミットか追えない。** バージョン ID とコミットの対応がリポジトリから読めなくなる
3. **検証を通らない配布経路ができる。** 上に書いた「配布前にテストとビルドを回す」という担保は `deploy.yml` の中にしかない。Workers Builds はこのワークフローを通らないので、**壊れたものが本番に載りうる**

**リポジトリに記録が残るのはこちらの経路だけ**（`wrangler.jsonc` にビルド設定は無く、Workers Builds はダッシュボードにしか存在しない）。設定がコードレビューにも履歴にも出てこない配布経路は、後から誰も理由を辿れない。

**トークンを Roll するときは配布経路への影響を確認する。** Workers Builds は Actions Secrets とは別に自分のビルドトークンを握っており、Cloudflare 側でトークンを再生成すると `The build token selected for this build has been deleted or rolled` で落ちる。
