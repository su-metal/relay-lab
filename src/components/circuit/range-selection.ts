/**
 * 範囲選択（ラバーバンド）の設定（design.md §8.6）。
 *
 * ドキュメントにも履歴にも属さない **画面の操作モード**なので `circuitStore` には
 * 置かず、`CircuitWorkspace` の state として Toolbar と CircuitCanvas が共有する。
 * ここに置いているのは、その型と表示文言を両者で 1 か所から読むため。
 */

/**
 * 範囲選択が拾う対象。
 *
 * 「部品と配線をまとめて消す」と「配線だけを引き直す」は別の作業で、
 * 後者では枠に入った部品まで選ばれると邪魔になる（逆も同じ）。
 *
 * **この設定が効くのは範囲選択のときだけ。** 単体クリックや Ctrl/⌘+クリックは
 * どのモードでも部品・配線の両方を選べる。プロパティパネルを見るために部品を
 * クリックする操作まで縛ると、対象の切り替えが作業のたびに必要になる。
 */
export type RangeSelectionTarget = "both" | "components" | "connections";

export const RANGE_SELECTION_TARGETS: readonly {
  value: RangeSelectionTarget;
  label: string;
  title: string;
}[] = [
  {
    value: "both",
    label: "部品＋配線",
    title: "枠に入った部品と、枠に触れた配線の両方を選びます",
  },
  {
    value: "components",
    label: "部品のみ",
    title:
      "枠に入った部品だけを選びます（削除すると、その端子に繋がる配線は道連れになります）",
  },
  {
    value: "connections",
    label: "配線のみ",
    title: "枠に触れた配線だけを選びます。部品は選ばれません",
  },
];
