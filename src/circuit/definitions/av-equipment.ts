/**
 * AV 機器（プロジェクター・VP コントローラー・モニター・電動スクリーン）の
 * 定義（design.md §4.19）。
 *
 * 調光操作卓・調光コントローラ（`lighting-system.ts`）が持つ端子 32・34〜36・
 * 38・39（電源 ON/OFF 出力・昇降 上昇/停止/下降出力・電源制御 NO/NC）の
 * **先につながる実機**にあたる。those の出力はまだ端子として置いてあるだけで
 * 何も駆動していない（`lighting-system.ts` のコメント参照）ため、
 * このファイルの部品は今のところ単体で（外部電源＋接点で）動かして使う。
 */

import type { ComponentDefinition } from "@/circuit/types";

/**
 * PT-VX430J の端子データの出典（design.md §4.19）。
 *
 * Panasonic『液晶プロジェクター PT-VX430J』仕様書
 * （VX430J_STM_01・2021/01/14 作成・1/8〜8/8）の
 * 「■機器仕様」（使用電源 AC100V 50Hz/60Hz）と
 * 「■接続端子リスト」（2/8 ページ）と照合済み。
 *
 * **接続端子リストに無電圧接点の外部制御端子は無く、外部制御は
 * シリアル入力端子（D-Sub 9P・メス型・RS-232C 準拠）のみ**であることを確認した。
 * この盤の他の機器のようにコイル・接点でリレー回路へ直接組み込める制御端子を
 * 実機は持たないため、電源 ON/OFF は VP コントローラー（本ファイル）を介して
 * シリアルコマンドで行う（ユーザー判断）。
 *
 * **USB A 端子（タイプA）は実機に実在する**（仕様書「■接続端子」・
 * 「USB メモリービューワー機能用／無線モジュール WML100J、AJ-WM50GT 用」）。
 * 無線モジュールのような周辺機器へ給電する端子であることから、
 * **VP コントローラーはこの USB 給電で動作する**（ユーザー判断）。
 * ただし USB の電源電圧（5V）・供給電流は仕様書に記載が無く、USB の
 * 規格値からの推定であって PT-VX430J 固有の実測・仕様確認ではない。
 *
 * AC100V 電源・シリアル入力端子・USB 端子はどれもねじ端子ではなくプラグ／
 * コネクタで、端子に印字された番号や記号は無い。したがって `verified` は
 * 立てない —— ここで検証したのは「端子構成の事実」であって「実端子番号」
 * ではなく、検証対象そのものが無い（CLAUDE.md 設計原則 5・design.md §4.4 の考え方）。
 */
const PT_VX430J_SOURCE =
  "Panasonic『液晶プロジェクター PT-VX430J』仕様書（VX430J_STM_01・2021/01/14 作成・1/8〜8/8）の「■機器仕様」「■接続端子リスト」（2/8ページ）と照合済み。AC100V 電源入力・シリアル入力端子（D-Sub 9P・メス型・RS-232C準拠）・USB A端子（無線モジュール用給電あり）を持ち、無電圧接点の外部制御端子は無いことを確認。USB の電源電圧（5V）は USB 規格からの推定でPT-VX430J固有の記載ではない。プラグ／コネクタ接続でねじ端子の印字が無いため、端子の呼称は本アプリの便宜的なもので実端子番号ではない";

/**
 * プロジェクター（Panasonic PT-VX430J）。
 *
 * **電気的には 2 つの顔を持つ。** AC100V を受ける入力側と、USB 経由で
 * VP コントローラーへ 5V を供給する出力側。これは AC を受けて絶縁 DC を
 * 生成する OMRON S8VM（`kind: "ac-dc-power-supply"`・design.md §4.18・§5.20）と
 * **まったく同じ物理的な振る舞い**なので、同じ kind を再利用する ——
 * 「AC が来ている間だけ、別の DC 電位を生成する」という判定はここでも
 * S8VM と同じ 1 つの実装で効く（CLAUDE.md 設計原則 2）。
 *
 * 実機の電源 ON/OFF はシリアルコマンド（RS-232C）で行うもので、
 * このシミュレーターは通信の中身を扱わない（design.md §6・CLAUDE.md
 * 「プロトコルは扱わない」）。**投影の ON/OFF が見たいときは、
 * VP コントローラーのコイル（励磁 = ON コマンド送信中）の方を見る。**
 *
 * シリアル入力端子は物理的な実在を示すためだけに置く。ピン配列（TX/RX/GND）
 * までは仕様書に無く、この端子を介した通信も本アプリは判定しない。
 */
export const projectorPtVx430j: ComponentDefinition = {
  id: "projector-panasonic-pt-vx430j",
  model: "PT-VX430J",
  manufacturer: "Panasonic",
  category: "av",
  terminals: [
    {
      id: "L",
      label: "L",
      role: "power_line",
      description: "AC100V 電源入力（非接地側）。実機はプラグ接続",
      position: { x: 0, y: 0.25 },
      side: "left",
    },
    {
      id: "N",
      label: "N",
      role: "power_neutral",
      description: "AC100V 電源入力（接地側）。実機はプラグ接続",
      position: { x: 0, y: 0.48 },
      side: "left",
    },
    {
      id: "SERIAL",
      label: "SERIAL",
      role: "generic",
      description:
        "シリアル入力端子（D-Sub 9P・メス型・RS-232C準拠）/ 外部制御用。" +
        "VP コントローラーからの電源 ON/OFF コマンドを受ける実在の配線先だが、" +
        "通信の中身は本アプリでは扱わない（design.md §6）",
      position: { x: 1, y: 0.5 },
      side: "right",
      optional: true,
    },
    {
      id: "VBUS",
      label: "VBUS",
      role: "power_positive",
      description:
        "USB A 端子 VBUS / 周辺機器給電用（無線モジュール等）。" +
        "電圧は USB 規格からの推定（実機の記載なし）",
      position: { x: 1, y: 0.75 },
      side: "right",
    },
    {
      id: "GND",
      label: "GND",
      role: "power_zero",
      description: "USB A 端子 GND",
      position: { x: 1, y: 0.9 },
      side: "right",
    },
  ],
  electrical: {
    kind: "ac-dc-power-supply",
    // 仕様書は「AC100V 50Hz/60Hz」の単一値のみで、S8VM のような
    // 定格/使用可能範囲の幅は記載が無い。範囲を持たせず単一値で置く
    ratedInputVoltageMin: 100,
    ratedInputVoltageMax: 100,
    allowableInputVoltageMin: 100,
    allowableInputVoltageMax: 100,
    lineTerminal: "L",
    neutralTerminal: "N",
    // USB の規格値（実機の記載なし・上記コメント参照）
    outputVoltage: 5,
    positiveTerminal: "VBUS",
    zeroTerminal: "GND",
  },
  visual: { width: 240, height: 200 },
  source: PT_VX430J_SOURCE,
  verified: false,
};

/**
 * VP コントローラー端子の出典（design.md §4.19）。
 *
 * **実機は無い、本アプリのための仮の中継機器。** PT-VX430J のように
 * 無電圧接点の制御端子を持たないプロジェクターへ、調光操作卓等の無電圧
 * 接点からの ON/OFF をシリアルコマンドへ変換して送る市販の RS-232C 接続
 * ボックス相当を想定している。
 *
 * **自分の動作用電源はプロジェクター自身の USB A 端子から取る**
 * （ユーザー判断）。外部に別の電源を必要としない —— コイルの正側
 * （`VBUS`）をプロジェクターの USB 出力へ、負側（`CTRL`）を「操作卓等の
 * 無電圧接点を経由して」プロジェクターの USB GND へ配線する形にすることで、
 * **プロジェクターが給電されていて、かつ操作卓の接点が閉じている**ときだけ
 * コイルが励磁する（`engine/graph.ts` の `ac-dc-power-supply` 判定がそのまま
 * 効く・design.md §5.20）。
 *
 * 特定製品と照合していないので `verified: false`。
 */
const VP_CONTROLLER_SOURCE =
  "実機を持たない仮の中継機器（本アプリのための一般化）。無電圧接点の制御端子を" +
  "持たないプロジェクターへ ON/OFF をシリアルコマンドへ変換して送る市販の" +
  "RS-232C 接続ボックス相当を想定。自分の動作用電源はプロジェクターの USB A" +
  "端子から取る構成（ユーザー判断）。特定製品のカタログとは未照合";

/**
 * VP コントローラー（プロジェクター用シリアル電源制御ボックス）。
 *
 * **コイルが励磁している＝プロジェクターへ ON コマンドを送信中**という
 * 意味を持たせる。実機の変換の中身（RS-232C のフレーム）は扱わない
 * （design.md §6）ので、接点は持たない —— コイルの励磁状態そのものが
 * 唯一の観測対象になる（プロパティパネルの「コイル」節に表示される）。
 *
 * **コイルは 2 端子だけで「給電」と「操作卓の接点が閉じているか」の
 * 両方を表す。** `VBUS` はプロジェクターの USB 出力へ直結し、`CTRL` は
 * 操作卓（や調光コントローラ）の無電圧接点を経由してプロジェクターの
 * USB GND（本コンポーネントの `GND` 端子経由でもよい）へ繋ぐ。
 * 実機なら電源系統と制御系統を分けて持つところを 2 端子に畳んでいるが、
 * このシミュレーターが見せたい「プロジェクターの給電が無ければそもそも
 * 動かず、操作卓の接点が開いていれば ON コマンドは送らない」という
 * 2 条件は、この形で過不足なく表せる。
 */
export const vpController: ComponentDefinition = {
  id: "av-controller-vp",
  model: "VPコントローラー",
  category: "av",
  terminals: [
    {
      id: "VBUS",
      label: "VBUS",
      role: "power_positive",
      description:
        "動作用電源 + / プロジェクターの USB A 端子 VBUS へ（ユーザー判断）",
      position: { x: 0, y: 0.25 },
      side: "left",
    },
    {
      id: "GND",
      label: "GND",
      role: "power_zero",
      description: "動作用電源 − / プロジェクターの USB A 端子 GND へ",
      position: { x: 0, y: 0.48 },
      side: "left",
    },
    {
      id: "CTRL",
      label: "CTRL",
      role: "coil",
      description:
        "制御入力（無電圧接点）/ 操作卓・調光コントローラ等の接点を経由して" +
        "GND（プロジェクターの USB GND）へ。閉じている間だけ ON コマンドを送る",
      position: { x: 0, y: 0.75 },
      side: "left",
    },
    {
      id: "SERIAL",
      label: "SERIAL",
      role: "generic",
      description:
        "シリアル出力 / プロジェクターのシリアル入力端子へ。" +
        "通信の中身は本アプリでは扱わない（design.md §6）",
      position: { x: 1, y: 0.5 },
      side: "right",
      optional: true,
    },
  ],
  electrical: {
    kind: "relay",
    relay: {
      coil: {
        // プロジェクターの USB 出力の想定電圧（実機の記載なし・USB 規格からの推定）
        voltage: 5,
        currentType: "DC",
        positiveTerminal: "VBUS",
        negativeTerminal: "CTRL",
        polarity: "none",
      },
      // 実機の出力はシリアルコマンドで、接点として持たない
      // （このファイルの doc comment 参照）
      contacts: [],
    },
  },
  visual: { width: 220, height: 180 },
  source: VP_CONTROLLER_SOURCE,
  verified: false,
};

/**
 * モニターの端子データの出典（design.md §4.19）。
 *
 * **型番を問わない汎用機器。** ユーザー判断で「一般的な業務用モニターの
 * 電源 ON/OFF ができれば十分」とされ、電源は AC100V を外部のリレー／
 * 電磁接触器の接点で直接断続する構成（ユーザー判断）。モニター自身に
 * 制御端子は持たせない —— 実機のモニターにも「ON/OFF 専用の無電圧接点
 * 入力」は無いのが普通で、遠隔での電源断続はコンセント側で行うのが実務
 * （`ac100vLamp` と同じ形・design.md §4.5）。
 */
const MONITOR_SOURCE =
  "汎用部品（実型番なし）。電源 ON/OFF は外部のリレー／電磁接触器の接点で" +
  "AC100V ラインを直接断続する構成（ユーザー判断）。端子の呼称は本アプリの" +
  "便宜的なもので、実端子番号ではない";

/**
 * モニター（汎用）。
 *
 * `lamp-ac100v` と電気的には同じ形（AC100V を受けるだけの負荷）。
 * カテゴリだけ `"av"` にして、プロジェクター・スクリーンと並べて探せる
 * ようにしてある（`category` は表示都合だけ・design.md §3.1）。
 */
export const monitorGeneric: ComponentDefinition = {
  id: "monitor-generic-ac100v",
  model: "モニター（汎用）",
  category: "av",
  terminals: [
    {
      id: "L",
      label: "L",
      role: "power_line",
      description: "端子 L / AC100V 電源入力（非接地側）",
      position: { x: 0, y: 0.5 },
      side: "left",
    },
    {
      id: "N",
      label: "N",
      role: "power_neutral",
      description: "端子 N / AC100V 電源入力（接地側）",
      position: { x: 1, y: 0.5 },
      side: "right",
    },
  ],
  electrical: {
    kind: "lamp",
    voltage: 100,
    currentType: "AC",
    terminalA: "L",
    terminalB: "N",
  },
  visual: { width: 180, height: 160 },
  source: MONITOR_SOURCE,
  verified: false,
};

/**
 * 電動スクリーンの端子データの出典（design.md §4.19・§5.21）。
 *
 * **型番を問わない汎用機器。** 多くの電動スクリーンが持つ
 * 「COM・UP・DOWN・STOP の無電圧接点入力 4 端子＋モーター用 AC100V」
 * という一般的な構成を採った（ユーザー判断：「反応・動作が分かればよい、
 * コントローラーから出た信号でリレーが反応する感じ」）。
 *
 * **上昇・下降・停止が同時に入力された場合のインターロックは、実機の
 * 仕様が不明のため持たせていない**（design.md §6 既知の制約）。3 系統は
 * 完全に独立して評価される。
 */
const SCREEN_SOURCE =
  "汎用部品（実型番なし）。電動スクリーンで一般的な「COM・UP・DOWN・STOP の" +
  "無電圧接点入力＋モーター用 AC100V」という構成を採用（ユーザー判断）。" +
  "上昇/下降/停止の同時入力に対するインターロックは実機の仕様が不明のため" +
  "持たせていない（design.md §6）。端子の呼称は本アプリの便宜的なもので、" +
  "実端子番号ではない";

/**
 * 電動スクリーン（汎用）。
 *
 * **上昇・停止・下降は 3 本の独立した無電圧接点入力**（design.md §5.21）。
 * 主コイルを持たず、3 つの補助コイル（`auxCoils`）だけを持つ ——
 * どれか 1 つが特別というわけではなく、3 系統が対等な入力だから
 * （`AuxCoil` の doc comment 参照）。
 *
 * 接点は持たない。動作の確認はプロパティパネルの「コイル」節に並ぶ
 * 上昇／停止／下降それぞれの励磁状態で行う —— 実機に無い出力接点を
 * 作って動作を示すことはしない（CLAUDE.md 設計原則 6）。
 *
 * モーター駆動用の AC100V は物理的な実在を示すためだけに置く。
 * 実際にモーターが回るかどうかは判定しない（design.md §6）。
 */
export const screenElectric: ComponentDefinition = {
  id: "screen-electric-generic",
  model: "電動スクリーン（汎用）",
  category: "av",
  terminals: [
    {
      id: "COM",
      label: "COM",
      role: "common",
      description: "COM / 無電圧接点入力の共通端子",
      position: { x: 0, y: 0.15 },
      side: "left",
    },
    {
      id: "UP",
      label: "UP",
      role: "generic",
      description: "UP / 上昇入力（COM と短絡すると上昇）",
      position: { x: 0, y: 0.4 },
      side: "left",
    },
    {
      id: "STOP",
      label: "STOP",
      role: "generic",
      description: "STOP / 停止入力（COM と短絡すると停止）",
      position: { x: 0, y: 0.6 },
      side: "left",
    },
    {
      id: "DOWN",
      label: "DOWN",
      role: "generic",
      description: "DOWN / 下降入力（COM と短絡すると下降）",
      position: { x: 0, y: 0.85 },
      side: "left",
    },
    {
      id: "ML",
      label: "L",
      role: "power_line",
      description: "モーター電源 L / AC100V（非接地側）",
      position: { x: 1, y: 0.35 },
      side: "right",
    },
    {
      id: "MN",
      label: "N",
      role: "power_neutral",
      description: "モーター電源 N / AC100V（接地側）",
      position: { x: 1, y: 0.65 },
      side: "right",
    },
  ],
  electrical: {
    kind: "relay",
    relay: {
      auxCoils: [
        {
          id: "up",
          label: "上昇",
          voltage: 24,
          currentType: "DC",
          positiveTerminal: "UP",
          negativeTerminal: "COM",
          polarity: "none",
        },
        {
          id: "stop",
          label: "停止",
          voltage: 24,
          currentType: "DC",
          positiveTerminal: "STOP",
          negativeTerminal: "COM",
          polarity: "none",
        },
        {
          id: "down",
          label: "下降",
          voltage: 24,
          currentType: "DC",
          positiveTerminal: "DOWN",
          negativeTerminal: "COM",
          polarity: "none",
        },
      ],
      contacts: [],
    },
  },
  visual: { width: 220, height: 220 },
  source: SCREEN_SOURCE,
  verified: false,
};
