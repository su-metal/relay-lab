"use client";

import type { KeyboardEvent, PointerEvent } from "react";

import { useSimulationStore } from "@/store/simulationStore";

import styles from "./bodies.module.css";
import type { BodyProps } from "./types";

/**
 * 押しボタン。a 接点（NO）は開いた線、b 接点（NC）は閉じた線で描く。
 * `contactType` を読むだけなので、型番が増えても分岐は増えない。
 * A/B の別はモデル名にも出るため、図記号側に文字は重ねない。
 *
 * シミュレーション中は操作ボタンを出し、押下中は図記号も実際の開閉に合わせる。
 * モーメンタリなので **押している間だけ**状態が変わる（マウスダウンで押下、
 * マウスアップで復帰）。ボタン外でマウスを離す事故に備えて
 * `pointerleave` / `pointercancel` でも必ず復帰させる。押しっぱなしのまま
 * 状態が残ると、自己保持回路の検証で「離したのに保持が効いている」と誤読する。
 */
export function SwitchBody({ definition, componentId, simulation }: BodyProps) {
  const pressSwitch = useSimulationStore((state) => state.pressSwitch);
  const releaseSwitch = useSimulationStore((state) => state.releaseSwitch);

  const electrical =
    definition.electrical.kind === "switch" ? definition.electrical : null;
  const normallyClosed = electrical?.contactType === "NC";

  const pressed = simulation?.pressed ?? false;
  // B 接点は押すと開き、A 接点は押すと閉じる
  const closed = normallyClosed !== pressed;

  const press = (event: PointerEvent<HTMLButtonElement>) => {
    // React Flow のノードドラッグを始動させない（`nodrag` と二重の保険）
    event.stopPropagation();
    pressSwitch(componentId);
  };

  const release = (event: PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    releaseSwitch(componentId);
  };

  // キーボード操作でもモーメンタリにする。button 既定の click では
  // 「押しっぱなし」を表現できないので keydown / keyup で扱う
  const keyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    if (event.repeat) return;
    pressSwitch(componentId);
  };

  const keyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    releaseSwitch(componentId);
  };

  return (
    <div className={styles.stack}>
      <svg
        className={styles.symbol}
        width="46"
        height="28"
        viewBox="0 0 46 28"
        aria-hidden
      >
        {/* 押しボタンの頭。押下中は少し沈める */}
        <g transform={pressed ? "translate(0 3)" : undefined}>
          <line x1="23" y1="0" x2="23" y2="6" />
          <line x1="15" y1="6" x2="31" y2="6" />
        </g>
        {/* 接点。閉じていれば水平、開いていれば斜め */}
        <line x1="2" y1="20" x2="14" y2="20" />
        {closed ? (
          <line className={styles.contactClosed} x1="14" y1="20" x2="32" y2="20" />
        ) : (
          <line x1="14" y1="20" x2="32" y2="12" />
        )}
        <line x1="32" y1="20" x2="44" y2="20" />
        <line x1="23" y1="6" x2="23" y2="14" strokeDasharray="2 2" />
      </svg>

      {simulation && (
        <button
          type="button"
          // React Flow はこのクラスの付いた要素の上でノードドラッグを始めない
          className={`${styles.pressButton} nodrag`}
          data-pressed={pressed ? "true" : undefined}
          aria-pressed={pressed}
          onPointerDown={press}
          onPointerUp={release}
          onPointerLeave={release}
          onPointerCancel={release}
          onKeyDown={keyDown}
          onKeyUp={keyUp}
        >
          {pressed ? "押下中" : "押す"}
        </button>
      )}
    </div>
  );
}
