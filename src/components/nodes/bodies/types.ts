import type { ComponentDefinition } from "@/circuit/types";

/**
 * カテゴリ別ボディの共通 props。
 *
 * 定義そのものを渡すのは、ボディ側が `electrical`（接点数・電圧・NO/NC）を
 * 読んで描き分けられるようにするため。**型番では分岐しない。**
 */
export type BodyProps = {
  definition: ComponentDefinition;
};
