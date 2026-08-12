/**
 * 接点の図記号（design.md §8.11）。
 *
 * `RelayBody` から切り出した。**タイマーもリレーなので同じ絵を使う**
 * （design.md §3.2）—— 2 箇所に写すと、b 接点を持たないリレーの扱いや
 * 端子番号の位置が片方だけずれる。
 */

import type { ContactInspection } from "@/circuit/adapter/inspection";

import styles from "./bodies.module.css";

/** 接点 1 極ぶんの図記号の寸法。番号を置く余白まで含めた枠 */
const CELL_WIDTH = 46;
const CELL_HEIGHT = 54;

/** 図記号の要所。COM の支点から NC / NO の固定接点へ可動片が倒れる */
const PIVOT = { x: 8, y: 27 };
const NC_POINT = { x: 32, y: 13 };
const NO_POINT = { x: 32, y: 41 };
/** どちらにも閉じていない a 接点の可動片の先。固定接点には届かせない */
const OPEN_TIP = { x: 30, y: 17 };

/**
 * 接点 1 極。COM の可動片が NC 側 / NO 側のどちらへ倒れているかを描く。
 *
 * **端子番号を図記号に添える。** 実端子番号を扱えることが本プロダクトの価値
 * （CLAUDE.md）であり、「9 番の COM が 1 番から 5 番へ移る」という動きこそ
 * リレーそのもの。番号の無い抽象的な接点記号を描いても、外周の端子と
 * 結び付かないので初めて読む人には繋がらない。
 */
function ContactSymbol({
  contact,
  closed,
  offset,
}: {
  contact: ContactInspection["contact"];
  /** 閉じている側。停止中は静止状態（非励磁）の絵を描く */
  closed: "no" | "nc" | "open";
  offset: number;
}) {
  // NC 端子が実機に無い a 接点（G7L など）に b 接点を描かない（design.md §4.8）
  const hasNc = contact.ncTerminal !== undefined;
  const tip = closed === "nc" ? NC_POINT : closed === "no" ? NO_POINT : OPEN_TIP;

  return (
    <g transform={`translate(${offset} 0)`}>
      {/* COM の引き出し線と支点 */}
      <line x1="0" y1={PIVOT.y} x2={PIVOT.x} y2={PIVOT.y} />
      <circle
        className={styles.switchPivot}
        cx={PIVOT.x}
        cy={PIVOT.y}
        r="2.5"
      />
      <text
        className={styles.contactNumber}
        x={PIVOT.x}
        y={PIVOT.y - 8}
        textAnchor="middle"
      >
        {contact.commonTerminal}
      </text>

      {hasNc && (
        <>
          <line
            x1={NC_POINT.x}
            y1={NC_POINT.y}
            x2={CELL_WIDTH - 4}
            y2={NC_POINT.y}
          />
          <text
            className={styles.contactNumber}
            x={CELL_WIDTH - 10}
            y={NC_POINT.y - 5}
            textAnchor="middle"
          >
            {contact.ncTerminal}
          </text>
        </>
      )}

      <line x1={NO_POINT.x} y1={NO_POINT.y} x2={CELL_WIDTH - 4} y2={NO_POINT.y} />
      <text
        className={styles.contactNumber}
        x={CELL_WIDTH - 10}
        y={NO_POINT.y + 11}
        textAnchor="middle"
      >
        {contact.noTerminal}
      </text>

      {/*
        可動片。閉じている側は通電色で描き、開閉が一目で分かるようにする
        （`SwitchBody` と同じ扱い）
      */}
      <line
        className={closed === "open" ? undefined : styles.contactClosed}
        x1={PIVOT.x}
        y1={PIVOT.y}
        x2={tip.x}
        y2={tip.y}
      />
    </g>
  );
}

/**
 * 接点を横に並べた図。接点が 1 つも無ければ何も描かない。
 *
 * **`.symbol` ではなく専用のクラスを使い、左右反転では鏡像にしない。**
 * 端子番号という文字を含む図であり、反転すると番号が読めなくなる
 * （`bodies.module.css` がキャプションを反転させないのと同じ理由）。
 */
export function ContactDiagram({
  contacts,
}: {
  contacts: readonly ContactInspection[];
}) {
  if (contacts.length === 0) return null;

  return (
    <svg
      className={styles.contactDiagram}
      width={CELL_WIDTH * contacts.length}
      height={CELL_HEIGHT}
      viewBox={`0 0 ${CELL_WIDTH * contacts.length} ${CELL_HEIGHT}`}
      aria-hidden
    >
      {contacts.map((entry, index) => (
        <ContactSymbol
          key={entry.contact.id}
          contact={entry.contact}
          closed={entry.closed ?? "open"}
          offset={index * CELL_WIDTH}
        />
      ))}
    </svg>
  );
}
