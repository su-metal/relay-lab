"use client";

/**
 * ラダー図（design.md §8.15）。
 *
 * キャンバスは**実体配線図** —— どの端子とどの端子を電線で結んだか —— を
 * 描くもので、これは本プロダクトの価値そのもの（実端子番号を扱う）だが、
 * 回路が何をする回路なのかを読むには向いていない。ラダー図はその逆で、
 * 端子の位置を捨てて**条件と出力の並び**だけを見る。
 *
 * 変換も文面もここには書かない（`adapter/ladder.ts` が持つ）。
 * 表示だけを受け持つ —— `WarningList` / `PathPreviewList` と同じ約束。
 * 画像で保存する絵も同じで、描くのは `adapter/ladder-svg.ts`、ダウンロード
 * 操作は `ladder-image.ts`。ここは押す場所と失敗の断りだけを持つ。
 *
 * **端子番号を落とさない。** 接点の下に必ず実端子番号（`9-5`）を添える。
 * 番号を落とすと一般的なラダー図と変わらなくなり、キャンバスの配線と
 * 照らせなくなる。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { buildLadder, rungText } from "@/circuit/adapter/ladder";
import type { LadderContact, LadderExpr, LadderOutput } from "@/circuit/adapter/ladder";
import { componentRegistry } from "@/circuit/definitions";
import { useCircuitStore } from "@/store/circuitStore";

import { saveLadderPng, saveLadderSvg } from "./ladder-image";
import styles from "./LadderDialog.module.css";

export type LadderDialogProps = {
  open: boolean;
  onClose: () => void;
};

export function LadderDialog({ open, onClose }: LadderDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  /*
   * パンやズームで組み直さないよう、`document` 全体は購読しない
   * （`useWiringCheck` と同じ理由）。中身は `getState()` でその場で読む
   */
  const components = useCircuitStore((state) => state.document.components);
  const connections = useCircuitStore((state) => state.document.connections);

  const ladder = useMemo(() => {
    // 閉じている間は組まない。回路を触るたびに裏で解き直す理由が無い
    if (!open) return { rungs: [], notes: [] };
    return buildLadder(useCircuitStore.getState().document, componentRegistry);
  }, [open, components, connections]);

  /**
   * 画像で保存できなかったときの断り（design.md §8.15）。
   *
   * PNG は `<img>` と `<canvas>` を通るので落ちうる。**押しても何も
   * 起きないのが一番困る**ので、失敗はここに出す。
   */
  const [saveError, setSaveError] = useState<string | null>(null);

  /*
   * 画像に焼いた図は**そのときの配線のスナップショット**で、以後の配線変更に
   * 追随しない（CLAUDE.md 設計原則 10）。図の右上に生成日時を入れるのは
   * そのためで、日時は `renderLadderSvg` ではなくここで読む（設計原則 1）
   */
  const handleSaveSvg = useCallback(() => {
    setSaveError(null);
    saveLadderSvg(ladder);
  }, [ladder]);

  const handleSavePng = useCallback(() => {
    setSaveError(null);
    void saveLadderPng(ladder).then((saved) => {
      if (!saved) {
        setSaveError(
          "PNG を作れませんでした。SVG で保存すると同じ図を書き出せます。",
        );
      }
    });
  }, [ladder]);

  // 開き直したら前回の失敗は消す（別の回路の話になっている）
  useEffect(() => {
    if (!open) setSaveError(null);
  }, [open]);

  /** `HelpDialog` と同じ開き方。モーダルでないと背後の回路を触れてしまう */
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  /**
   * 開いている間、キャンバスのショートカットを黙らせる（`HelpDialog` と同じ）。
   * D / F / L は修飾キー無しの 1 打鍵で回路を変える。
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
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      aria-labelledby="ladder-dialog-title"
    >
      <div className={styles.head}>
        <h2 id="ladder-dialog-title" className={styles.title}>
          ラダー図
        </h2>
        {/*
          画像で保存（design.md §8.15）。**画面を写し取るのではなく
          `adapter/ladder-svg.ts` が図を描き直す**ので、横にはみ出した段も
          スクロールせずに 1 枚へ収まる。

          段が 1 本も無いときは絵にする中身が無いので押せない
        */}
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.save}
            onClick={handleSavePng}
            disabled={ladder.rungs.length === 0}
            title="いまのラダー図を PNG 画像として保存します（資料に貼る用）"
          >
            PNG で保存
          </button>
          <button
            type="button"
            className={styles.save}
            onClick={handleSaveSvg}
            disabled={ladder.rungs.length === 0}
            title="いまのラダー図を SVG（ベクタ）として保存します（拡大しても崩れません）"
          >
            SVG で保存
          </button>
        </div>
        <button
          type="button"
          className={styles.close}
          onClick={onClose}
          aria-label="ラダー図を閉じる"
        >
          ×
        </button>
      </div>

      <div className={styles.body}>
        <p className={styles.scope}>
          いまの配線から組み立てた図です。接点の下の番号は実端子番号で、
          キャンバスの配線とそのまま照らせます。
          {/*
            **保存対象ではないことを言っておく。** ここを直せば配線が直ると
            読まれると、図面と実配線が食い違ったまま作業が進む
          */}
          この図は読むためのもので、ここを編集しても配線は変わりません。
        </p>

        {saveError && (
          <p className={styles.saveError} role="alert">
            {saveError}
          </p>
        )}

        {ladder.rungs.length === 0 ? (
          <p className={styles.empty}>
            出力（コイル・ランプ）を置いて配線すると、ここに段が出ます。
          </p>
        ) : (
          <div className={styles.ladder}>
            <ol className={styles.rungs}>
              {ladder.rungs.map((rung, index) => (
                <li key={rung.output.componentId} className={styles.rung}>
                  {/*
                    図は読み上げられないので、`adapter/ladder.ts` が組んだ
                    文をそのまま添える。**図と文を別々に組み立てない**
                  */}
                  <span className={styles.srOnly}>{rungText(rung)}</span>
                  <span className={styles.index} aria-hidden>
                    {index + 1}
                  </span>
                  <div className={styles.wireArea} aria-hidden>
                    {rung.blocked ? (
                      <span className={styles.blocked}>{rung.blocked}</span>
                    ) : (
                      <span className={styles.condition}>
                        {rung.condition ? (
                          <ExprView expr={rung.condition} />
                        ) : (
                          <span className={styles.direct} />
                        )}
                      </span>
                    )}
                    <OutputView output={rung.output} />
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}

        {ladder.notes.length > 0 && (
          <ul className={styles.notes}>
            {ladder.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}
      </div>
    </dialog>
  );
}

/**
 * 条件式を描く。直列は横に並べ、並列は縦に積んで両端を縦線でつなぐ。
 *
 * 横線は CSS（`.line` の擬似要素）が引き、図記号の側が自分の下地で
 * 線を隠す。**接点の内側で線が途切れて見えるのがラダー図の読み方**なので、
 * 図記号に下地を持たせないと開いている接点が閉じて見える。
 */
function ExprView({ expr }: { expr: LadderExpr }) {
  switch (expr.kind) {
    case "contact":
      return <ContactView contact={expr.contact} />;
    case "series":
      return (
        <span className={styles.series}>
          {expr.items.map((item, index) => (
            <ExprView key={index} expr={item} />
          ))}
        </span>
      );
    case "parallel":
      return (
        <span className={styles.parallel}>
          {expr.items.map((item, index) => (
            <span key={index} className={styles.branch}>
              <ExprView expr={item} />
            </span>
          ))}
        </span>
      );
  }
}

/** 接点 1 枚。上に呼び名、下に実端子番号 */
function ContactView({ contact }: { contact: LadderContact }) {
  return (
    <span className={styles.element}>
      <span className={styles.elementLabel}>
        {contact.label}
        {/*
          限時接点はふつうの a / b 接点と動く条件が違う（設定時間の経過が要る）。
          図記号だけでは読み取れないので言葉で添える（design.md §5.13）
        */}
        {contact.delay && (
          <span className={styles.badge}>
            {contact.delay === "on-delay" ? "限時動作" : "限時復帰"}
          </span>
        )}
        {contact.maintained && <span className={styles.badge}>位置保持</span>}
      </span>
      <svg className={styles.symbol} viewBox="0 0 44 24" role="presentation">
        <line x1="0" y1="12" x2="15" y2="12" />
        <line x1="15" y1="4" x2="15" y2="20" />
        <line x1="29" y1="4" x2="29" y2="20" />
        <line x1="29" y1="12" x2="44" y2="12" />
        {/* b 接点は 2 本の縦線に斜線を重ねる（JIS の書き方） */}
        {contact.kind === "nc" && <line x1="12" y1="21" x2="32" y2="3" />}
      </svg>
      <span className={styles.elementTerminals}>
        {contact.terminalLabels[0]}-{contact.terminalLabels[1]}
      </span>
    </span>
  );
}

/** 出力（コイル・ランプ）。段の右端に置く */
function OutputView({ output }: { output: LadderOutput }) {
  return (
    <span className={styles.element} data-output>
      <span className={styles.elementLabel}>
        {output.label}
        {output.delay && (
          <span className={styles.badge}>
            {output.delay === "on-delay" ? "限時動作" : "限時復帰"}
          </span>
        )}
      </span>
      <svg className={styles.symbol} viewBox="0 0 44 24" role="presentation">
        <line x1="0" y1="12" x2="14" y2="12" />
        <line x1="30" y1="12" x2="44" y2="12" />
        {output.kind === "coil" ? (
          <>
            {/* コイルは括弧 —( )— */}
            <path d="M18 4 A 9 9 0 0 0 18 20" fill="none" />
            <path d="M26 4 A 9 9 0 0 1 26 20" fill="none" />
          </>
        ) : (
          <>
            {/* ランプは丸に × */}
            <circle cx="22" cy="12" r="8" fill="none" />
            <line x1="16.5" y1="6.5" x2="27.5" y2="17.5" />
            <line x1="27.5" y1="6.5" x2="16.5" y2="17.5" />
          </>
        )}
      </svg>
      <span className={styles.elementTerminals}>
        {output.terminalLabels[0]}-{output.terminalLabels[1]}
      </span>
    </span>
  );
}
