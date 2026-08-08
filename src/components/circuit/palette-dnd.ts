/**
 * パレット → キャンバス のドラッグ＆ドロップで受け渡す内容。
 *
 * 運ぶのは `ComponentDefinition.id` の 1 本だけ。定義そのものを
 * `dataTransfer` に詰める（JSON 化する）ことはしない —
 * 定義の実体はレジストリにしか無い、という一元管理を崩さないため。
 */

/** 独自 MIME。他アプリからのドロップと混ざらないようにする */
export const PALETTE_DND_MIME = "application/x-relay-lab-definition-id";

/** `dataTransfer` から定義 ID を取り出す。無ければ null */
export const readDefinitionId = (dataTransfer: DataTransfer): string | null => {
  const id =
    dataTransfer.getData(PALETTE_DND_MIME) ||
    // 一部ブラウザは独自 MIME を落とすため text/plain も見る
    dataTransfer.getData("text/plain");
  return id || null;
};
