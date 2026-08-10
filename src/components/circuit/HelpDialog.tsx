"use client";

/**
 * 操作ヘルプ（design.md §8.10）。
 *
 * 出すのは 3 つ。**基本の 3 手**・**操作一覧**（`lib/shortcuts.ts` の定数から
 * 組み立て済み）・**このシミュレーターが扱わないこと**（design.md §6）。
 *
 * 判定も文面もここには書かない。表示だけを受け持つ。
 */

import { useEffect, useRef } from "react";
import type { KeyboardEvent } from "react";

import { APP_NAME } from "@/lib/app-info";
import { BASIC_STEPS, LIMITATIONS } from "@/lib/help-content";
import { SHORTCUT_GROUPS } from "@/lib/shortcuts";

import styles from "./HelpDialog.module.css";

export type HelpDialogProps = {
  open: boolean;
  onClose: () => void;
};

export function HelpDialog({ open, onClose }: HelpDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  /**
   * `open` 属性ではなく `showModal()` で開く。
   *
   * モーダルとして開いた `<dialog>` だけがフォーカスを閉じ込め、Esc で閉じ、
   * 背後のキャンバスを `::backdrop` で覆う。属性で開くと**ヘルプを読みながら
   * 背後の部品を操作できてしまう。**
   */
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  /**
   * **ヘルプを開いている間、キャンバスのショートカットを黙らせる。**
   *
   * D / F / L は修飾キー無しの 1 打鍵で回路を変える（削除・反転・整列）。
   * それらのリスナーは `window` と React Flow 側にあり、`<dialog>` が
   * フォーカスを閉じ込めていてもイベントの伝播そのものは止まらない。
   * ここで止めておかないと、ヘルプを読みながら押した文字で背後の回路が消える。
   *
   * React のハンドラーはルートコンテナで処理されるので、`window` や
   * `document` のリスナーより先に走る。Esc での閉じ方は `cancel` イベント
   * （ブラウザ側）なので、これを止めても効かなくならない。
   */
  const swallowKeys = (event: KeyboardEvent<HTMLDialogElement>) => {
    event.stopPropagation();
  };

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      onKeyDown={swallowKeys}
      onKeyUp={swallowKeys}
      // Esc で閉じたときも親の状態を戻す（`cancel` → `close` の順に来る）
      onClose={onClose}
      // 背景（`::backdrop`）のクリックは `<dialog>` 自身が受け取る。
      // 中身のクリックは子要素が target になるのでここは通らない
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      aria-labelledby="help-dialog-title"
    >
      <div className={styles.head}>
        <h2 id="help-dialog-title" className={styles.title}>
          {APP_NAME} の使い方
        </h2>
        <button
          type="button"
          className={styles.close}
          onClick={onClose}
          aria-label="ヘルプを閉じる"
        >
          ×
        </button>
      </div>

      <div className={styles.body}>
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>まずこの 3 手</h3>
          <ol className={styles.steps}>
            {BASIC_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>

        {SHORTCUT_GROUPS.map((group) => (
          <section key={group.title} className={styles.section}>
            <h3 className={styles.sectionTitle}>{group.title}</h3>
            <dl className={styles.rows}>
              {group.rows.map((row) => (
                <div key={row.action} className={styles.row}>
                  <dt className={styles.keys}>
                    {/*
                      区切りの「/」は**手前のキーにくっつける。** 後ろに付けると
                      折り返した行が「/」で始まって読みにくい
                    */}
                    {row.keys.map((key, index) => (
                      <span key={key}>
                        <kbd className={styles.key}>{key}</kbd>
                        {index < row.keys.length - 1 && (
                          <span className={styles.or}>/</span>
                        )}
                      </span>
                    ))}
                  </dt>
                  <dd className={styles.action}>
                    {row.action}
                    {row.note && <span className={styles.note}>{row.note}</span>}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}

        {/*
          扱わないことを隠さない（design.md §6）。仕様上そうなる挙動を
          黙っていると、ユーザーはそれをバグとして受け取る。
        */}
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>このシミュレーターが扱わないこと</h3>
          <ul className={styles.limitations}>
            {LIMITATIONS.map((limitation) => (
              <li key={limitation.title}>
                <strong className={styles.limitationTitle}>
                  {limitation.title}
                </strong>
                <span className={styles.limitationBody}>{limitation.body}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </dialog>
  );
}
