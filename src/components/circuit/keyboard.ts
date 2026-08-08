/**
 * 自前のキーボードショートカットが共通で使う判定（design.md §8.1）。
 *
 * **入力欄にフォーカスがあるときはキャンバスの操作を発火させない。**
 * React Flow の `deleteKeyCode` は `isInputDOMNode()` で同じ除外を内部に
 * 持っているが、自前で `window` に載せるハンドラーには効かない。
 * ここを忘れると、部品名を打っている最中の 1 打鍵で回路が変わる。
 */

export const isTextEntry = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement);
