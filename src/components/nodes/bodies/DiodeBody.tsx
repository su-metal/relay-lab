import styles from "./bodies.module.css";

/**
 * ダイオード。JIS の図記号（三角＋帯）で向きを示す。
 *
 * アノード（左・三角の底辺側）からカソード（右・帯側）へ向かう向きを、
 * 端子ラベル A / K と一致させて描く。**向きが読めることがこの部品の全て**で、
 * 端子番号のような追加情報は無い。
 *
 * MVP では常に開放なので通電表現は持たない（design.md §5.4）。
 * 通電中の見た目を作ると、導通していないのに電流が流れているように見える。
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
      <span className={styles.caption}>整流作用は未実装</span>
    </div>
  );
}
