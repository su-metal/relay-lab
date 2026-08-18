# relay-lab — リレー回路シミュレーター

実メーカー・実型番・**実端子番号**でリレー回路を配線し、動作をシミュレーションする Web アプリ。抽象化された「リレー」ではなく `OMRON MY4N-D2 の端子 14` を扱えることが本プロダクトの価値。

詳細は `requirements_definition.md`（プロダクト要件）、`design.md`（技術設計）、`requirements.md`（今回の作業スコープ）。

## 技術構成のうち、コードから読み取れないもの

- CSS は **CSS Modules**。Tailwind 等の CSS フレームワークは使わない
- 画面は PC の 3 カラムが基本。狭い画面（900px 未満）と指の端末での出し分けは `useViewportMode.ts` の 1 箇所が判定し、**見た目は `data-compact` 属性で切り替える**（同じブレークポイントを CSS に書き写さない・`design.md` §8.12）
- バックエンド・ログイン・DB は持たない。永続化は LocalStorage
- 部品データは TypeScript でローカル保持。将来 Supabase / Firebase へ移行できる構造を崩さない
- デプロイは **main への push で自動**（`.github/workflows/deploy.yml`）。静的書き出し（`out/`）を Cloudflare Workers へ配る。リポジトリの Actions Secrets に `CLOUDFLARE_API_TOKEN`（必要なら `CLOUDFLARE_ACCOUNT_ID`）が要る。手元から配るなら `npm run deploy`（`design.md` §9.1）

## 設計原則（必ず守ること）

1. **エンジンは React / Zustand / React Flow を import しない。** 純粋関数として実装し Vitest で検証する。React コンポーネント内に回路判定ロジックを書かない。**時計も読まない** —— タイマーの「今が何 ms か」は `SimulationInput.nowMs` として受け取り、`performance.now()` を呼ぶのは `simulationStore` だけ（`design.md` §5.13）。
2. **エンジンに型番分岐を書かない。** `if (model === "MY4N")` は禁止。エンジンは `ComponentDefinition` を読んで動作する。新型番の追加が定義ファイル 1 枚で完結すること。
3. **負荷（コイル・ランプ・ダイオード）はグラフ上で union しない。** union するのは電線・端子台・閉じている接点/スイッチのみ。負荷を union すると電源短絡判定が誤爆する（`design.md` §5.2）。
4. **表示用の React Flow Edge と電気的接続を同一視しない。** 内部表現は端子グラフ (`CircuitConnection`)、間に adapter を置く。
5. **端子番号には必ず `source`（出典）と `verified` を持たせる。** 未検証の型番を検証済みとして扱わない。MY2N / MY4N / MY4N-D2 は OMRON 公式データシート（J199）と照合済み、G7L-1A-B / G7L-2A-B は公式カタログ（CDPA-041C）と照合済みで `verified: true`（`design.md` §4.4・§4.9）。**新しい型番を足すときは `verified: false` から始め、公式資料の該当ページの図を自分で確認できたときだけ `true` にする。** 出典にはページと図の名前まで残す（後から再検証できなくなるため）。特に MY2N1 / MY4N1 など末尾に「1」が付く型番はコイルの極性が逆（Type 2）、G7L も端子形状違い（-T / -P）は別の図なので、**既存の端子表を流用しない。**

6. **接点の形をリレーの型で決め打ちしない。** すべてのリレーが c 接点を持つわけではない。G7L は a 接点のみで b 接点の端子が実機に無く、コイルにも極性が無い。逆に電磁接触器の補助 b 接点（21–22）は **a 接点の端子が無い**（`design.md` §4.8・§4.12）。無い端子を空文字で埋めたり、`coil_positive` を当てて実機に無い極性を主張したりしない。**`noTerminal` と `ncTerminal` は対称に扱うこと** —— 一方だけを `undefined` 前提で書くと、もう片方の形が静かにすり抜ける（`design.md` §3.2）。

7. **タイマーリレーはリレーとして表す。** `ElectricalDefinition` に `kind: "timer"` を作らず、`kind: "relay"` の `delay?: TimerDelay` の有無で分ける（`design.md` §5.13）。実機がリレーである以上、接点・コイル・端子まわりの判定を 2 本に分ける理由が無く、分けると片方だけ直す事故が起きる。`category: "timer"` はパレットと図記号の出し分けという表示都合だけ。

8. **`energizedRelays` は「接点が切り替わっている」であって「コイルが励磁している」ではない。** 遅延なしのリレーでは一致するが、タイマーは設定時間のあいだ「コイルは入っているが接点はまだ」の状態にいる。コイルの側を見たいときは `coilEnergized()` を使う —— 取り違えると、計測中のタイマーのコイル配線が非通電（灰色）に見える（`design.md` §5.13）。

## ドキュメント更新トリガー

該当する変更を入れたら、**同じ作業の中で**ドキュメントも更新する。

| 変更内容 | 更新先 |
|---|---|
| `src/circuit/types/` の型定義 | `design.md` §3 |
| `src/circuit/definitions/` の部品追加・変更 | `design.md` §4（端子データ表・確度表） |
| `src/circuit/engine/` の判定ロジック | `design.md` §5 |
| ディレクトリ構成 | `design.md` §2 |
| 実装できない制約が判明 | `design.md` §6 |
| 端子データを実機・データシートで検証した | `design.md` §4 の確度表＋定義ファイルの `verified` |
| 作業単位が完了 | `requirements.md` を次スコープで上書き |
| 対応部品・画面構成・スコープの変更 | `requirements_definition.md` と本ファイル |

`.claude/hooks/check-docs-fresh.mjs`（Stop フック）が `src/circuit/{types,definitions,engine}/` の未コミット差分と `design.md` を突き合わせ、更新漏れがあれば終了をブロックする。整形やコメント修正など更新不要な場合は、理由を述べて終了してよい。**このフックは初回コミット以降のみ動作する。**

このため、ツールチェーン疎通など回路モデルと無関係なテストは `src/__tests__/` に置き、監視対象ディレクトリを汚さない。

## 開発フロー

Step 単位（`requirements.md` 参照）で以下を回す。

1. plan mode（`Shift+Tab`）で対象ファイルを読み、計画を立てて承認を得る
2. 実装し、`npm test` で検証する。成功を主張せず、テスト出力を示す
3. コミットする
4. 次の Step の前に `/clear` する

Stop フックは 2 本ある（`.claude/settings.json`）。

| フック | 役割 |
|---|---|
| `check-tests-pass.mjs` | `vitest run` を実行し、落ちていれば終了をブロックして出力を差し戻す。`node_modules` が無い間は素通り |
| `check-docs-fresh.mjs` | 上記のドキュメント更新漏れを検出する。初回コミット以降のみ動作 |

タスク分解と進捗は `TodoWrite` で管理する（`tasklist.md` は作らない）。記述はすべて日本語。
