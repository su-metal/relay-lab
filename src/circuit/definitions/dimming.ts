/**
 * 調光（0–10V のアナログ量）の定義（design.md §4.14 / §5.17）。
 *
 * 実型番を持たない汎用部品。**逆特性（0V = 100% / 10V = 0%）はここが持つ。**
 * ユーザーの会社の調光仕様は一般的な 0–10V 機器と真逆で、この 1 点が
 * 「挿し忘れると全灯する」という本スコープ最大の価値に直結している。
 *
 * その対応を `if (model === "FMD-701D") invert` と書いた瞬間に設計が壊れる
 * （CLAUDE.md 設計原則 2）ので、**エンジンが読むのは電圧だけ**にして、
 * % への変換は下の `AnalogCurve` という宣言に閉じてある。順特性の機器を
 * 足すときは `percentAtMin` / `percentAtMax` を入れ替えるだけで済み、
 * `engine/analog.ts` は 1 行も変わらない。
 *
 * **実型番（FMD-701D）はここには無い。** 社内オリジナル製品で公開データ
 * シートが存在せず、実端子記号を主張するには社内図面の図番・版数・確認日を
 * `source` に残す工程が要る（CLAUDE.md 設計原則 5）。接点入力が
 * どのチャンネルを何 V にするか・DIRECT / CUT が信号線に何をするかも
 * 未確定なので、本スコープは汎用部品で閉じている。
 */

import type { AnalogCurve, ComponentDefinition } from "@/circuit/types";

import { GENERIC_TERMINAL_SOURCE } from "./source-notes";

/**
 * ユーザーの会社の調光仕様。**0V = 100%、10V = 0% の逆特性。**
 *
 * 一般的な 0–10V 機器（0V = 消灯）と真逆で、この向きだからこそ
 * 「調光信号線を挿し忘れる／抜けると全灯する」という、消えるより
 * 気付きにくい失敗が起きる（requirements.md ③）。
 */
export const INVERTED_0_10V_CURVE: AnalogCurve = {
  minVolts: 0,
  maxVolts: 10,
  percentAtMin: 100,
  percentAtMax: 0,
};

/**
 * 汎用 0–10V 調光出力。
 *
 * 端子は信号（`V+`）とコモン（`COM`）の 2 つだけ。
 *
 * **コモンの役割を `power_zero` にしない。** 実際の盤ではコモンを電源の 0V へ
 * 繋ぐが、それは配線の話であって端子の役割ではない。ここを `power_zero` と
 * 書くと、繋いでいなくても電源の 0V がそこにあるかのように画面が主張し、
 * 「GND を共通にしていない」という最も捕まえたい誤配線が読めなくなる。
 *
 * 既定を 5V（＝50%）にしてあるのは、置いた直後の姿を
 * **未接続時（0V ＝ 100%）とも DIRECT（0V ＝ 100%）とも違うレベル**に
 * するため。既定が 0V だと、繋いでも繋がなくても全灯で、
 * 配線が効いているかどうかが画面から読めない。
 */
export const dimmerOutput0to10v: ComponentDefinition = {
  id: "dimmer-0-10v",
  model: "0–10V 調光出力",
  category: "dimmer",
  terminals: [
    {
      id: "V+",
      label: "V+",
      role: "analog_signal",
      description: "V+ / 調光信号（0–10V）",
      position: { x: 1, y: 0.3 },
      side: "right",
    },
    {
      id: "COM",
      label: "COM",
      role: "analog_common",
      description: "COM / 調光信号の基準（0V コモン）",
      position: { x: 1, y: 0.7 },
      side: "right",
    },
  ],
  electrical: {
    kind: "analog-source",
    signalTerminal: "V+",
    commonTerminal: "COM",
    minVolts: 0,
    maxVolts: 10,
    defaultVolts: 5,
  },
  // 本体に出す出力電圧（"5.0V ／ 50%"）が収まる幅
  visual: { width: 170, height: 150 },
  source: GENERIC_TERMINAL_SOURCE,
  verified: false,
};

/**
 * 汎用調光ランプ（AC100V）。
 *
 * **`kind` はただの `lamp`。** 調光ランプはランプであって別種の負荷ではなく、
 * 点灯条件（両端が同じ 1 台の電源の + と 0V に届くか）は普通のランプと
 * まったく同じ。違うのは `dimming` を持つことだけで、これはタイマーを
 * `relay` の `delay` で表したのと同じ形（CLAUDE.md 設計原則 7）。
 *
 * 端子は 4 つ。電源の 2 本（`1` / `2`）と調光信号の 2 本（`DIM+` / `DIM−`）で、
 * **電源が来ていなければ調光レベルに関わらず消灯する** —— 0–10V は
 * 明るさを決めるだけで、灯りをともすのは電源のほうだから。
 *
 * `unconnectedVolts: 0` は「入力段がプルダウンされている」の意味で、
 * この曲線では **100%（全灯）**になる。**実機の入力回路次第の値なので
 * エンジンには持たせない**（requirements.md ③）。FMD-701D を足すときは
 * 社内図面で確認した値をその定義に書く。
 */
export const dimmableLampAc100v: ComponentDefinition = {
  id: "lamp-dimmable-ac100v",
  model: "AC100V 調光ランプ",
  category: "lamp",
  terminals: [
    {
      id: "1",
      label: "1",
      role: "generic",
      description: "端子 1 / 電源（極性なし）",
      position: { x: 0, y: 0.32 },
      side: "left",
    },
    {
      id: "2",
      label: "2",
      role: "generic",
      description: "端子 2 / 電源（極性なし）",
      position: { x: 0, y: 0.68 },
      side: "left",
    },
    {
      id: "DIM+",
      label: "DIM+",
      role: "analog_signal",
      description: "DIM+ / 調光信号（0–10V・0V で 100%）",
      position: { x: 1, y: 0.32 },
      side: "right",
    },
    {
      id: "DIM-",
      label: "DIM−",
      role: "analog_common",
      description: "DIM− / 調光信号の基準（0V コモン）",
      position: { x: 1, y: 0.68 },
      side: "right",
    },
  ],
  electrical: {
    kind: "lamp",
    voltage: 100,
    currentType: "AC",
    terminalA: "1",
    terminalB: "2",
    dimming: {
      signalTerminal: "DIM+",
      commonTerminal: "DIM-",
      curve: INVERTED_0_10V_CURVE,
      unconnectedVolts: 0,
    },
  },
  // 左右に 2 端子ずつ出るぶん、通常のランプより広く取る
  visual: { width: 180, height: 170 },
  source: GENERIC_TERMINAL_SOURCE,
  verified: false,
};
