import type { DeviceSimulationState } from "@/circuit/adapter/simulation-view";
import type { ComponentDefinition } from "@/circuit/types";

/**
 * カテゴリ別ボディの共通 props。
 *
 * 定義そのものを渡すのは、ボディ側が `electrical`（接点数・電圧・NO/NC）を
 * 読んで描き分けられるようにするため。**型番では分岐しない。**
 */
export type BodyProps = {
  definition: ComponentDefinition;
  /** 部品インスタンス ID。押しボタンの押下操作（Step 4）で使う */
  componentId: string;
  /**
   * シミュレーション中の状態。**停止中は `undefined`。**
   * 「消磁している」と「そもそも動いていない」を描き分けるための区別。
   */
  simulation?: DeviceSimulationState;
};
