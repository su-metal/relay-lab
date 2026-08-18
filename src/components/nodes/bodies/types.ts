import type { PreviewDeviceState } from "@/circuit/adapter/reactflow";
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
  /**
   * 経路確認モードでの状態（design.md §8.14）。**モード外は `undefined`。**
   *
   * `simulation` と排他で、両方が入ることは無い（`simulationStore` が
   * `running` と `pathPreview` を排他にしている）。スイッチだけがこれを読み、
   * 倒す操作子を出す —— **リレーは動かないので、他のボディには使い道が無い。**
   */
  preview?: PreviewDeviceState;
  /**
   * タイマーの設定時間（ms）。インスタンスごとの値なので `definition` からは
   * 読めず、**停止中も出したい**ので `simulation` にも載せられない
   * （design.md §5.13）。タイマー以外では `undefined`。
   */
  presetMs?: number;
};
