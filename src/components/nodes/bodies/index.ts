/**
 * カテゴリ → ボディ の対応表。
 *
 * **ここは「カテゴリ」で分岐してよい唯一の層。** 見た目の差はカテゴリ単位で
 * しか存在せず、型番の差（MY4N / MY2N）は `ComponentDefinition` の中身だけで
 * 表現される。型番でボディを分けたくなったら設計が壊れているサイン。
 */

import type { ComponentType } from "react";

import type { ComponentCategory } from "@/circuit/types";

import { DimmerBody } from "./DimmerBody";
import { DiodeBody } from "./DiodeBody";
import { GenericBody } from "./GenericBody";
import { LampBody } from "./LampBody";
import { PowerSupplyBody } from "./PowerSupplyBody";
import { RelayBody } from "./RelayBody";
import { SwitchBody } from "./SwitchBody";
import { TerminalBlockBody } from "./TerminalBlockBody";
import { TimerBody } from "./TimerBody";
import type { BodyProps } from "./types";

const BODIES: Record<ComponentCategory, ComponentType<BodyProps>> = {
  power: PowerSupplyBody,
  switch: SwitchBody,
  relay: RelayBody,
  lamp: LampBody,
  diode: DiodeBody,
  terminal: TerminalBlockBody,
  timer: TimerBody,
  dimmer: DimmerBody,
  /*
   * AV 機器（design.md §4.19）は `kind: "lamp"`（プロジェクター・モニター）と
   * `kind: "relay"`（VP コントローラー・スクリーン）が混在するカテゴリで、
   * どちらか一方の専用ボディを当てはめると片方の見た目が壊れる。
   * `GenericBody` は元々この用途（専用ボディの無いカテゴリの受け皿）で
   * 用意されている。
   */
  av: GenericBody,
};

export const bodyForCategory = (
  category: ComponentCategory,
): ComponentType<BodyProps> => BODIES[category] ?? GenericBody;

export type { BodyProps };
