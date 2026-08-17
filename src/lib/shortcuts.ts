/**
 * キー・マウス割り当ての単一の出典（design.md §8.10）。
 *
 * **ここが唯一の定義で、React Flow へ渡す値もヘルプの表もここから作る。**
 * 割り当てを `CircuitCanvas` の中に置いたままヘルプへ書き写すと、キーを変えた
 * 瞬間にヘルプが嘘になる。嘘のヘルプは無いヘルプより悪い —— 「D で消えるはず」と
 * 信じて押した打鍵が別の動作をする。
 *
 * このファイルは React も React Flow も import しない。`SHORTCUT_GROUPS` が
 * 定数から組み立てられていることを `__tests__/shortcuts.test.ts` が押さえる。
 */

/**
 * 削除のキー（`ReactFlow.deleteKeyCode`）。Delete / Backspace に加えて **D 単独**。
 *
 * Delete キーはフルサイズキーボードでは右上の端にあり、配線しながら片手で押すには
 * 遠い。D は「配線ドラッグ → 掴み損ねた線を消す」の往復がホームポジションのまま済む。
 * 大文字を併記するのは CapsLock 対策（`event.key` が "D" になる）。
 */
export const DELETE_KEYS = ["Delete", "Backspace", "d", "D"];

/** 部品の左右反転（`useFlipShortcut`）。F 単独 */
export const FLIP_KEYS = ["f", "F"];

/** 配置の自動整理（`useArrangeShortcut`）。L 単独 */
export const ARRANGE_KEYS = ["l", "L"];

/**
 * シミュレーションの開始・停止（`useSimulationShortcut`）。S 単独（Start / Stop）。
 *
 * **Space は割り当てない。** スイッチの押しボタンが Space / Enter で押下・復帰を
 * 表現しており、シミュレーション中はそのボタンにフォーカスが残る。Space を
 * 停止に充てると「スイッチを押す」のか「停止する」のかが打鍵時のフォーカス位置で
 * 変わる（design.md §8.2）。
 */
export const SIMULATION_KEYS = ["s", "S"];

/**
 * 画面移動の同時押しキー（`ReactFlow.panActivationKeyCode`）。
 *
 * 素の左ドラッグを範囲選択に取ったので、パンを Shift へ逃がしている
 * （design.md §8.6）。`selectionKeyCode` を `null` にすることとセット。
 */
export const PAN_ACTIVATION_KEY = "Shift";

/** ドラッグでパンできるマウスボタン（`ReactFlow.panOnDrag`）。中ボタンと右ボタン */
export const PAN_BUTTONS = [1, 2];

/** 複数選択の同時押しキー（`ReactFlow.multiSelectionKeyCode`） */
export const MULTI_SELECT_KEYS = ["Control", "Meta"];

/**
 * 表示用にキーを畳む。`["d", "D"]` は割り当てとしては 2 つでも、
 * ユーザーにとっては 1 つの「D」でしかない。
 */
export const displayKeys = (keys: readonly string[]): string[] => [
  ...new Set(keys.map((key) => (key.length === 1 ? key.toUpperCase() : key))),
];

export type ShortcutRow = {
  /** キーやマウス操作。複数あれば「/」で区切って並べる */
  keys: readonly string[];
  action: string;
  /** 補足（なぜそのキーなのか・どこに効くのか） */
  note?: string;
};

export type ShortcutGroup = {
  title: string;
  rows: readonly ShortcutRow[];
};

/**
 * ヘルプに出す操作一覧。
 *
 * キーボードだけでなくマウス操作も同じ表に載せる。**初見でいちばん困るのは
 * 「画面が動かせない」**（素の左ドラッグが範囲選択に取られている）であって、
 * それはキーボードショートカットの表には現れない。
 */
export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    title: "配置と編集",
    rows: [
      {
        keys: displayKeys(DELETE_KEYS),
        action: "選択中の部品と配線を削除",
        note: "まとめて消しても Undo 1 回で戻る",
      },
      {
        keys: displayKeys(FLIP_KEYS),
        action: "選択中の部品を左右反転",
        note: "端子の出る辺を入れ替えるだけで、端子番号も配線も変わらない",
      },
      {
        keys: displayKeys(ARRANGE_KEYS),
        action: "配置を整列",
        note: "選択中があればそれだけ、無ければ全体",
      },
      { keys: ["Ctrl/⌘ + Z"], action: "元に戻す" },
      { keys: ["Ctrl/⌘ + Shift + Z", "Ctrl + Y"], action: "やり直す" },
    ],
  },
  {
    title: "画面と選択",
    rows: [
      {
        keys: ["ドラッグ"],
        action: "範囲選択",
        note: "何もない所から。枠に収まった部品と、枠に触れた配線が選ばれる",
      },
      {
        keys: [
          `${PAN_ACTIVATION_KEY} + ドラッグ`,
          "中ドラッグ / 右ドラッグ",
          "ホイール",
        ],
        action: "画面を動かす",
        note: "素の左ドラッグは範囲選択に割り当てている",
      },
      { keys: ["Ctrl/⌘ + ホイール"], action: "拡大・縮小" },
      { keys: ["Ctrl/⌘ + クリック"], action: "選択に足す・外す" },
    ],
  },
  {
    title: "シミュレーション",
    rows: [
      {
        keys: displayKeys(SIMULATION_KEYS),
        action: "シミュレーションの開始・停止",
        note: "操作バーの ▶ / ■ と同じ。停止すると押下状態と励磁状態は捨てられる",
      },
    ],
  },
  {
    title: "配線",
    rows: [
      {
        keys: ["端子からドラッグ"],
        action: "端子どうしを配線",
        note: "接続は必ず端子 → 端子。部品そのものには繋げない",
      },
      {
        keys: ["配線の端をドラッグ"],
        action: "つなぎ替え",
        note: "空きスペースへ落とせば元に戻る（消えない）",
      },
    ],
  },
  /**
   * タッチ操作（design.md §8.12）。
   *
   * **キーボードとマウスの表だけでは足りない。** 指の端末では割り当てが
   * 変わる —— D&D が使えず（タップで置く）、素の 1 本指ドラッグは範囲選択
   * ではなく画面移動になる。Delete キーが無いので、削除の唯一の経路が
   * 操作バーのボタンになることも、ここに書かないと辿り着けない。
   */
  {
    title: "タッチ操作（スマートフォン・タブレット）",
    rows: [
      {
        keys: ["部品をタップ"],
        action: "部品を置く（指）",
        note: "画面下の「部品」から。いま見えている範囲の中央に出る（ドラッグ＆ドロップは指では使えない）",
      },
      {
        keys: ["1 本指でドラッグ"],
        action: "画面を動かす（指）",
        note: "部品の上から始めれば部品が動く。範囲選択は指では使えない",
      },
      { keys: ["2 本指でつまむ"], action: "拡大・縮小（指）" },
      {
        keys: ["操作バーの「削除」"],
        action: "選択を削除（指）",
        note: "Delete / D キーの代わり。部品や配線をタップして選んでから押す",
      },
    ],
  },
];
