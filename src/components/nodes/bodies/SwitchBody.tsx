"use client";

import type { KeyboardEvent, PointerEvent } from "react";

import { useSimulationStore } from "@/store/simulationStore";

import styles from "./bodies.module.css";
import type { BodyProps } from "./types";

/** ノードドラッグの始動だけ止める（状態は click で変える） */
const stopOnly = (event: PointerEvent<HTMLButtonElement>) => {
  event.stopPropagation();
};

/**
 * スイッチ。a 接点（NO）は開いた線、b 接点（NC）は閉じた線で描く。
 * 読むのは `contactType` と `action` の 2 値だけなので、型番が増えても分岐は増えない。
 * A/B の別はモデル名にも出るため、図記号側に文字は重ねない。
 *
 * **シミュレーション中と経路確認中**に操作子を出し、図記号も実際の開閉に合わせる。
 * 操作の仕方は `action` で分かれる（design.md §4.7）。
 *
 * 経路確認中に倒せるのは、スイッチが**人の手で決まる**入力だから（§8.14）。
 * リレーの接点は回路を解いた結果なので、あちらは動かない —— だからここだけが
 * `preview` を読むボディになる。倒した結果は色と一覧に即座に出る。
 *
 * - **モーメンタリ**（押しボタン）: 押している間だけ状態が変わる。ボタン外で
 *   マウスを離す事故に備えて `pointerleave` / `pointercancel` でも必ず復帰させる。
 *   押しっぱなしのまま状態が残ると、自己保持回路の検証で「離したのに保持が
 *   効いている」と誤読する
 * - **オルタネート**（切替スイッチ）: 1 クリックで ON 位置に留まり、もう 1 回で戻る。
 *   こちらは離しても復帰させてはならない
 */
export function SwitchBody({
  definition,
  componentId,
  simulation,
  preview,
}: BodyProps) {
  const pressSwitch = useSimulationStore((state) => state.pressSwitch);
  const releaseSwitch = useSimulationStore((state) => state.releaseSwitch);
  const toggleSwitch = useSimulationStore((state) => state.toggleSwitch);

  const electrical =
    definition.electrical.kind === "switch" ? definition.electrical : null;
  const normallyClosed = electrical?.contactType === "NC";
  const maintained = electrical?.action === "maintained";

  /*
    操作子を出すのは実行中か経路確認中。**両方が同時に立つことは無い**
    （`simulationStore` が `running` と `pathPreview` を排他にしている）。
  */
  const operable = simulation !== undefined || preview !== undefined;
  const operated = simulation?.pressed ?? preview?.operated ?? false;
  // B 接点は操作すると開き、A 接点は操作すると閉じる
  const closed = normallyClosed !== operated;

  const press = (event: PointerEvent<HTMLButtonElement>) => {
    // React Flow のノードドラッグを始動させない（`nodrag` と二重の保険）
    event.stopPropagation();
    pressSwitch(componentId);
  };

  const release = (event: PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    releaseSwitch(componentId);
  };

  const toggle = (event: PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    toggleSwitch(componentId);
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

  // オルタネートは button 既定の click で足りる（Space / Enter もこれで動く）。
  // pointerdown 側で拾わないのは、ドラッグ開始と誤って切り替わるのを避けるため
  const maintainedHandlers = { onClick: toggle, onPointerDown: stopOnly };
  const momentaryHandlers = {
    onPointerDown: press,
    onPointerUp: release,
    onPointerLeave: release,
    onPointerCancel: release,
    onKeyDown: keyDown,
    onKeyUp: keyUp,
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
        {maintained ? (
          // 切替スイッチ。押しボタンの頭は付けず、支点と接点を丸で示す
          // （復帰ばねを持たない＝操作した位置に留まる、という図記号の約束）
          <>
            <circle cx="14" cy="20" r="2" className={styles.switchPivot} />
            <circle cx="32" cy="20" r="2" className={styles.switchPivot} />
          </>
        ) : (
          // 押しボタンの頭。押下中は少し沈める
          <g transform={operated ? "translate(0 3)" : undefined}>
            <line x1="23" y1="0" x2="23" y2="6" />
            <line x1="15" y1="6" x2="31" y2="6" />
          </g>
        )}
        {/* 接点。閉じていれば水平、開いていれば斜め */}
        <line x1="2" y1="20" x2="14" y2="20" />
        {closed ? (
          <line className={styles.contactClosed} x1="14" y1="20" x2="32" y2="20" />
        ) : (
          <line x1="14" y1="20" x2="32" y2="12" />
        )}
        <line x1="32" y1="20" x2="44" y2="20" />
        {/* 押しボタンの頭と接点をつなぐ操作リンク。頭が沈んでも据え置く */}
        {!maintained && (
          <line x1="23" y1="6" x2="23" y2="14" strokeDasharray="2 2" />
        )}
      </svg>

      {operable && (
        <button
          type="button"
          // React Flow はこのクラスの付いた要素の上でノードドラッグを始めない
          className={`${styles.pressButton} nodrag`}
          data-pressed={operated ? "true" : undefined}
          // 予測であることは配線と同じ約束（破線・発光なし）で表す（§8.14）
          data-preview={preview ? "true" : undefined}
          aria-pressed={operated}
          title={
            preview
              ? "この状態で電位がどこまで届くかを確かめます（リレーの接点は動きません）"
              : undefined
          }
          {...(maintained ? maintainedHandlers : momentaryHandlers)}
        >
          {maintained ? (operated ? "ON" : "OFF") : operated ? "押下中" : "押す"}
        </button>
      )}

      {/*
        操作しているのに両端が非通電（design.md §5.12）。

        **「ON なのに配線が灰色」を矛盾のまま放置しない。** 実際には正しい ——
        スイッチを閉じるのは 2 点を繋ぐだけで、電流を作る操作ではない。
        先行優先回路では「起動した瞬間に自分が回路から切り離される」ことが
        正常な最終状態になる。黙っているとバグとして受け取られる。

        **出し入れではなく `visibility` で見せ消しする。** 条件付きで DOM から
        外すと行の高さが消え、上下中央寄せの本体ごと繰り上がって操作ボタンが
        動く。ON にした瞬間にボタンが逃げると押し間違えるので、
        シミュレーション中は切離の有無に関わらず 1 行分を確保しておく。
      */}
      {simulation && (
        <span
          className={styles.cutOffCaption}
          data-visible={simulation.cutOff ? "true" : undefined}
        >
          回路から切離
        </span>
      )}
    </div>
  );
}
