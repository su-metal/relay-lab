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
 */

import { BaseEdge, getSmoothStepPath } from "@xyflow/react";
import type { EdgeProps } from "@xyflow/react";

import type { WireEdge as WireEdgeType } from "@/circuit/adapter/reactflow";

import styles from "./WireEdge.module.css";

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
  const [path] = getSmoothStepPath({
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

  return (
    <>
      {/* 本体より先に描くことで下に敷かれる。当たり判定には出さない */}
      <path className={styles.halo} d={path} />
      <BaseEdge
        id={id}
        path={path}
        style={style}
        markerStart={markerStart}
        markerEnd={markerEnd}
        interactionWidth={interactionWidth}
      />
    </>
  );
}
