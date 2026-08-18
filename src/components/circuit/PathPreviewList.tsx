"use client";

/**
 * 経路確認モードの「止まっている箇所」（右カラム・design.md §8.14）。
 *
 * キャンバスは**どこまで電位が来ているか**を色で見せるが、色だけでは
 * 「どの端子とどの端子の間で止まっているか」までは読めない —— 開いている
 * 接点は線が繋がっていないので、そもそも見るべき場所が画面に無い。
 * ここが端子番号でそれを言う。**このプロダクトの価値そのもの**（`RY1 の 9 → 5`）。
 *
 * 表示専用で、判定も文面の組み立ても持たない（`WarningList` と同じ約束）。
 * 文言は `adapter/path-preview.ts` が組み、解くのは `usePathPreview` 1 箇所。
 */

import { useCircuitStore } from "@/store/circuitStore";
import { useSimulationStore } from "@/store/simulationStore";

import { usePathPreview } from "./usePathPreview";
import styles from "./PathPreviewList.module.css";

/** 電源のどちら側が止まっているか。色はキャンバスの配線と揃える */
const SIDE_LABEL = { plus: "+ 側", zero: "0V" } as const;

export function PathPreviewList() {
  const pathPreview = useSimulationStore((state) => state.pathPreview);
  const preview = usePathPreview();
  const selectOnlyComponent = useCircuitStore(
    (state) => state.selectOnlyComponent,
  );
  const empty = useCircuitStore(
    (state) => state.document.components.length === 0,
  );

  if (!pathPreview) return null;

  return (
    <section className={styles.panel} aria-label="経路確認">
      <h2 className={styles.title}>
        経路確認
        {preview.blockers.length > 0 && (
          <span className={styles.total}>{preview.blockers.length}</span>
        )}
      </h2>

      {/*
        いま何を見ているのかを必ず添える（`WarningList` の `scope` と同じ理由）。

        **リレーが動かないことを先に言う**（design.md §8.14）。スイッチが
        倒せるようになった以上、読み手は「押した先」を見ているつもりになる。
        コイルが励磁色になってもその接点は開いたままなので、黙っていると
        自己保持もインターロックも壊れているように見える。
      */}
      <p className={styles.scope}>
        スイッチを倒しながら、電源から電位が届いている範囲を塗っています。
        <strong>リレーの接点は動きません</strong> —— コイルが励磁する所までを
        見るモードです。動作した先は ▶ で確認してください。
      </p>

      {preview.activeLoadCount > 0 && (
        <p className={styles.active}>
          この状態で励磁・点灯する負荷が {preview.activeLoadCount} 個あります。
        </p>
      )}

      {preview.blockers.length === 0 ? (
        <p className={styles.empty}>
          {empty
            ? "部品を置くと経路を表示します。"
            : "電位が止まっている接点はありません。"}
        </p>
      ) : (
        <ul className={styles.items}>
          {preview.blockers.map((blocker, index) => (
            <li key={`${blocker.componentId}-${blocker.side}-${index}`}>
              <button
                type="button"
                className={styles.item}
                onClick={() => selectOnlyComponent(blocker.componentId)}
                title="該当する部品を選択します"
              >
                <span className={styles.side} data-side={blocker.side}>
                  {SIDE_LABEL[blocker.side]}
                </span>
                <span className={styles.path}>
                  {blocker.name} {blocker.fedLabel} → {blocker.blockedLabel}
                </span>
                <span className={styles.action}>{blocker.action}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
