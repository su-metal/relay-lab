import styles from "./bodies.module.css";

/**
 * ダイオード。JIS の図記号（三角＋帯）で向きを示す。
 *
 * アノード（左・三角の底辺側）からカソード（右・帯側）へ向かう向きを、
 * 端子ラベル A / K と一致させて描く。**向きが読めることがこの部品の全て**で、
 * 端子番号のような追加情報は無い。
 *
 * **通電表現は持たない。** 順方向なら電位を通す（design.md §5.4）が、それは
 * 両側の端子と配線の色として既に出ている。記号まで光らせると、逆方向で
 * 遮断しているのか順方向で通しているのかを色の違いで読ませることになり、
 * 「三角の向き」という一番確実な手がかりから目を逸らさせる。
 */
export function DiodeBody() {
  return (
    <div className={styles.stack}>
      <svg
        className={styles.symbol}
        width="52"
        height="26"
        viewBox="0 0 52 26"
        aria-hidden
      >
        <line x1="0" y1="13" x2="16" y2="13" />
        <path className={styles.diodeArrow} d="M16 5 L34 13 L16 21 Z" />
        <line x1="34" y1="5" x2="34" y2="21" />
        <line x1="34" y1="13" x2="52" y2="13" />
      </svg>
      <span className={styles.caption}>A → K のみ導通</span>
    </div>
  );
}
