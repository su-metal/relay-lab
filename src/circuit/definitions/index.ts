/**
 * 部品定義のレジストリ。
 *
 * 新しい型番の追加は「定義ファイルを 1 枚書いて、この配列に足す」だけで完結する。
 * エンジンは `ComponentDefinitionRegistry`（ID → 定義の Map）を受け取るだけで、
 * 一覧も型番も知らない（CLAUDE.md 設計原則 2）。
 *
 * Step 7 で MY2N / MY4N-D2 / 端子台 / ダイオードを足したが、
 * **エンジンの差分は 0 行**（requirements.md US-F）。
 * 切替スイッチ（オルタネート）も同じく定義データだけで足りている（design.md §4.7）。
 *
 * 調光（`dimming.ts`）は 2 部品のうち**ランプ側が定義データだけで足りている** ——
 * 調光ランプは `kind: "lamp"` に `dimming` を足しただけで、点灯判定も経路説明も
 * 図記号もランプ用のコードがそのまま効く（design.md §5.17）。
 * 調光出力（`analog-source`）だけが新しい `kind` で、これは電位を配るのでも
 * 負荷になるのでもない別の振る舞いだから避けられなかった。
 *
 * G7L（a 接点のみのパワーリレー）だけは、この原則を保ったまま
 * **接点の形の表現力を 1 段広げる**必要があった。`RelayContact.ncTerminal` を
 * 省略可能にした 1 点で、エンジンの分岐は増えていない（design.md §5.1）。
 */

import type {
  ComponentCategory,
  ComponentDefinition,
  ComponentDefinitionRegistry,
} from "@/circuit/types";

import { genericContactor } from "./contactors";
import { dimmableLampAc100v, dimmerOutput0to10v } from "./dimming";
import { genericDiode } from "./diodes";
import {
  dimmingConsole,
  dimmingController16ch,
  lightController4ch,
  phaseControlDimmer,
} from "./lighting-system";
import { ac100vLamp, dc24vLamp } from "./lamps";
import { omronG7l1aBDc24 } from "./omron/g7l-1a-b-dc24";
import { omronG7l2aBDc24 } from "./omron/g7l-2a-b-dc24";
import { omronMy2nDc24 } from "./omron/my2n-dc24";
import { omronMy4nD2Dc24 } from "./omron/my4n-d2-dc24";
import { omronMy4nDc24 } from "./omron/my4n-dc24";
import { omronS8vm05024 } from "./omron/s8vm-05024";
import { ac100vPowerSupply, dc24vPowerSupply } from "./power";
import {
  pushbuttonNc,
  pushbuttonNo,
  selectorSwitchNc,
  selectorSwitchNo,
} from "./switches";
import { genericTerminalBlock } from "./terminals";
import { offDelayTimer, onDelayTimer } from "./timers";

/** パレットの表示順もこの並びに従う */
export const componentDefinitions: readonly ComponentDefinition[] = [
  dc24vPowerSupply,
  ac100vPowerSupply,
  omronS8vm05024,
  pushbuttonNo,
  pushbuttonNc,
  selectorSwitchNo,
  selectorSwitchNc,
  omronMy2nDc24,
  omronMy4nDc24,
  omronMy4nD2Dc24,
  omronG7l1aBDc24,
  omronG7l2aBDc24,
  genericContactor,
  onDelayTimer,
  offDelayTimer,
  dc24vLamp,
  ac100vLamp,
  dimmableLampAc100v,
  dimmerOutput0to10v,
  dimmingController16ch,
  phaseControlDimmer,
  lightController4ch,
  dimmingConsole,
  genericDiode,
  genericTerminalBlock,
];

/** 定義 ID → 定義。エンジンへ渡すのはこれ（design.md §5.5 の `defs`） */
export const componentRegistry: ComponentDefinitionRegistry = new Map(
  componentDefinitions.map((definition) => [definition.id, definition]),
);

/** 定義 ID で引く。見つからなければ undefined */
export const getComponentDefinition = (
  id: string,
): ComponentDefinition | undefined => componentRegistry.get(id);

/**
 * 定義 ID で引く。見つからなければ例外。
 * 保存データの読み込みなど、定義が存在して当然の箇所で使う。
 */
export const requireComponentDefinition = (id: string): ComponentDefinition => {
  const definition = componentRegistry.get(id);
  if (!definition) {
    throw new Error(`未知の部品定義 ID です: ${id}`);
  }
  return definition;
};

/**
 * 型番で引く（"MY4N" → OMRON MY4N DC24V）。
 * 型番は表示・検索のためのものなので、大文字小文字は無視する。
 */
export const findComponentDefinitionByModel = (
  model: string,
): ComponentDefinition | undefined =>
  componentDefinitions.find(
    (definition) => definition.model.toLowerCase() === model.toLowerCase(),
  );

/** カテゴリで絞り込む。パレットのカテゴリ分け（Step 3）で使う */
export const listComponentDefinitions = (
  category?: ComponentCategory,
): ComponentDefinition[] =>
  category
    ? componentDefinitions.filter(
        (definition) => definition.category === category,
      )
    : [...componentDefinitions];

export {
  ac100vLamp,
  dimmingConsole,
  lightController4ch,
  ac100vPowerSupply,
  dimmingController16ch,
  phaseControlDimmer,
  dc24vLamp,
  dc24vPowerSupply,
  dimmableLampAc100v,
  dimmerOutput0to10v,
  genericContactor,
  genericDiode,
  genericTerminalBlock,
  offDelayTimer,
  omronG7l1aBDc24,
  omronG7l2aBDc24,
  omronMy2nDc24,
  omronMy4nD2Dc24,
  omronMy4nDc24,
  omronS8vm05024,
  onDelayTimer,
  pushbuttonNc,
  pushbuttonNo,
  selectorSwitchNc,
  selectorSwitchNo,
};
