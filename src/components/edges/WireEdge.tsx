"use client";

/**
 * 配線の Edge（design.md §8.7）。
 *
 * 既定の `smoothstep` を使わずに自前で描いているのは 2 つの理由から。
 *
 * 1. **幹線をずらせるのは `centerX` / `centerY` だけ。** React Flow 標準の
 *    `SmoothStepEdge` が外へ出しているのは `pathOptions.offset` と `borderRadius`
 *    のみで、どちらも折れる位置を動かさない。レーン分離（`adapter/wire-lane.ts`）を
 *    効かせるには `getSmoothStepPath` を直接呼ぶ必要がある
 * 2. **縁取り（halo）を線の下に敷くため。** 交差した配線を 1 本だけ拾い上げるには
 *    背景色で周りを抜く帯が要る。同じ `<g>` の中で本体より先に描く
 *
 * 経路の計算そのものは `getSmoothStepPath` に任せる。ここは「どれだけずらすか」を
 * 足すだけで、折れ方の規則は React Flow と同じものが使われる。
 *
 * 電流の向き（design.md §5.10）もここで描く。**向きの判定は一切しない** ——
 * `adapter/current-flow.ts` が決めた `data.flow` を受け取るだけ。
 */

import { BaseEdge, Position, getSmoothStepPath } from "@xyflow/react";
import type { EdgeProps } from "@xyflow/react";

import type { WireEdge as WireEdgeType } from "@/circuit/adapter/reactflow";
import { straightRunPath } from "@/circuit/adapter/wire-lane";
import type { TerminalSide } from "@/circuit/types";

import styles from "./WireEdge.module.css";

/**
 * React Flow の `Position` → 端子の辺。
 *
 * 値は同じ文字列だが**キャストで済ませない。** `wire-lane.ts` は
 * `@xyflow/react` に実行時依存を持たない（node 環境の Vitest で検証するため）
 * ので、React Flow の型を持ち込むのはこちら側の仕事。
 */
const SIDE_OF_POSITION: Record<Position, TerminalSide> = {
  [Position.Left]: "left",
  [Position.Right]: "right",
  [Position.Top]: "top",
  [Position.Bottom]: "bottom",
};

/**
 * つなぎ替えの掴み手の半径（design.md §8.8）。React Flow の `reconnectRadius` に
 * そのまま渡す値で、当たり判定の円は**端子から外向きにこの距離ずらした点**を
 * 中心に置かれる（`EdgeUpdateAnchors`）。
 *
 * 既定の 10 では狭い。端子側は Handle が半径 12px ぶんの当たり判定を持ち、
 * ノードは Edge より手前に描かれるので、端子に近い側は端子に取られる。
 * 14 にすると端子の外に十分な帯（12〜28px）が残り、**掴み手を狙ったのに
 * 新しい配線が伸び始める**という取り違えが起きにくい。
 *
 * 折れ線が端子から真っ直ぐ出る距離（`getSmoothStepPath` の既定オフセット 20px）
 * より内側なので、この位置に打つ点は必ず線の上に乗る。
 */
export const WIRE_RECONNECT_RADIUS = 14;

/** 見えている掴み手の点の半径。当たり判定（上記 14px）より小さくてよい */
const GRIP_RADIUS = 4;

/** 端子から外向き（配線が出ていく向き）へ `distance` px ずらす */
const shiftOutward = (
  x: number,
  y: number,
  position: Position,
  distance: number,
): { x: number; y: number } => {
  switch (position) {
    case Position.Left:
      return { x: x - distance, y };
    case Position.Right:
      return { x: x + distance, y };
    case Position.Top:
      return { x, y: y - distance };
    case Position.Bottom:
      return { x, y: y + distance };
  }
};

export function WireEdge({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  markerStart,
  markerEnd,
  style,
  interactionWidth,
  data,
}: EdgeProps<WireEdgeType>) {
  const lane = data?.lane ?? 0;
  const flow = data?.flow;

  /*
   * 両端が真っ直ぐ向かい合う配線は `getSmoothStepPath` が直線を返し、
   * `centerX` / `centerY` を動かしても 1 px も動かない（design.md §8.7）。
   * この形だけは経路を自前で組んで、レーンぶん横へ逃がす。
   * 対象外なら `null` が返り、従来どおり smoothstep に任せる。
   */
  const jogged = straightRunPath({
    source: { x: sourceX, y: sourceY },
    target: { x: targetX, y: targetY },
    sourceSide: SIDE_OF_POSITION[sourcePosition],
    targetSide: SIDE_OF_POSITION[targetPosition],
    offset: lane,
  });

  const [smoothPath] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    /*
     * ずらさない配線には **`undefined` を渡す。** `getSmoothStepPath` は
     * `center.x ?? 既定値` で受けるので、これで従来とまったく同じ経路になる。
     * 中点を自前で計算して渡すと、上下端子や回り込む配線で React Flow の
     * 既定値（端子から離れた点どうしの中点）と食い違う。
     */
    centerX: lane === 0 ? undefined : (sourceX + targetX) / 2 + lane,
    centerY: lane === 0 ? undefined : (sourceY + targetY) / 2 + lane,
  });

  const path = jogged ?? smoothPath;

  // 掴み手の当たり判定は React Flow（EdgeUpdateAnchors）が透明な円で持っている。
  // ここで描くのは**見えるようにするための点だけ**なので、同じ位置に重ねる
  const sourceGrip = shiftOutward(
    sourceX,
    sourceY,
    sourcePosition,
    WIRE_RECONNECT_RADIUS,
  );
  const targetGrip = shiftOutward(
    targetX,
    targetY,
    targetPosition,
    WIRE_RECONNECT_RADIUS,
  );

  return (
    <>
      {/* 本体より先に描くことで下に敷かれる。当たり判定には出さない */}
      <path className={styles.halo} d={path} />
      <BaseEdge
        id={id}
        path={path}
        /*
         * 自己保持の紫は線そのものが流れる破線（§5.9）。その流れる向きを
         * 電流の向きに合わせる。**インラインで渡すのは、CSS の
         * `animation-direction` を切り替える手段が Edge には無いため** ——
         * `className` は `<g>` に付くので、`.react-flow__edge-path` を
         * 直接指す形にできない。
         */
        style={flow === "backward" ? { ...style, animationDirection: "reverse" } : style}
        markerStart={markerStart}
        markerEnd={markerEnd}
        interactionWidth={interactionWidth}
      />
      {/*
        電流の向き（design.md §5.10）。線の上を背景色の切れ目が流れていく。

        出さないのは 2 つ。**向きが決まらない線**（並列に分かれた区間は実際に
        分流するので `current-flow.ts` が向きを返さない）と、**線そのものが
        流れる破線になっている線**（自己保持の紫。重ねると周期の違う破線が
        2 つ重なって模様が壊れる —— そちらは上の `animationDirection` が担う）
      */}
      {flow && !data?.flowOnStroke && (
        <path className={styles.flow} data-flow={flow} d={path} />
      )}
      {/*
        つなぎ替えの掴み手（design.md §8.8）。ホバー / 選択中だけ現れる。
        当たり判定は React Flow の透明な円が持つので、こちらは
        `pointer-events: none` にして掴む邪魔をしない
      */}
      <circle
        className={styles.grip}
        cx={sourceGrip.x}
        cy={sourceGrip.y}
        r={GRIP_RADIUS}
      />
      <circle
        className={styles.grip}
        cx={targetGrip.x}
        cy={targetGrip.y}
        r={GRIP_RADIUS}
      />
    </>
  );
}
