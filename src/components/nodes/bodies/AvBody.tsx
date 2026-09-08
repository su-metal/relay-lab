import { GenericBody } from "./GenericBody";
import styles from "./bodies.module.css";
import type { BodyProps } from "./types";

/**
 * AV 機器（design.md §4.19）。
 *
 * **1 枚で 4 通りを描き分ける。** カテゴリ `"av"` は `kind: "lamp"`
 * （モニター）と `kind: "relay"`（VP コントローラー・スクリーン）と
 * `kind: "ac-dc-power-supply"`（プロジェクター）が混在し、`RelayBody` /
 * `LampBody` をそのまま当てると片方の見た目が壊れる。分岐は `DimmerBody`
 * と同じく **electrical の形**で行い、型番は見ない（CLAUDE.md 設計原則 2）。
 *
 * - `kind: "lamp"` → モニター。実機の映像は無いので「表示中かどうか」
 *   だけを画面の絵で示す
 * - `kind: "relay"` かつ `auxCoils` を持つ → 電動スクリーン。上昇・停止・
 *   下降（design.md §5.21）をそれぞれ独立した表示にする
 * - `kind: "relay"` かつコイルを持ち `auxCoils` を持たない → VP コントローラー。
 *   **投影の ON/OFF そのものは電気的に持たない**（プロジェクターは
 *   シリアルコマンドで動くため）ので、コイルの励磁（＝プロジェクターへ
 *   ON コマンド送信中・design.md §4.19）を見せることで代える
 * - `kind: "ac-dc-power-supply"` → プロジェクター。**投影の ON/OFF は
 *   ここでも持たない**が、一次側（AC100V）が来ていて USB 出力が実際に
 *   成立しているかどうかは持つ（`simulation.powered`・design.md §5.20）。
 *   実機の電源ランプに相当する表示灯として見せる
 * - それ以外は専用の絵を持たない。未知の `electrical.kind` でも画面が
 *   壊れないよう、他のカテゴリと同じ既定の箱（`GenericBody`）に委ねる
 */
export function AvBody(props: BodyProps) {
  const { electrical } = props.definition;

  if (electrical.kind === "lamp") {
    return <MonitorVisual simulation={props.simulation} />;
  }

  if (electrical.kind === "relay" && (electrical.relay.auxCoils?.length ?? 0) > 0) {
    return <ScreenVisual simulation={props.simulation} />;
  }

  if (electrical.kind === "relay" && electrical.relay.coil) {
    return <VpControllerVisual simulation={props.simulation} />;
  }

  if (electrical.kind === "ac-dc-power-supply") {
    return <ProjectorVisual simulation={props.simulation} />;
  }

  return <GenericBody {...props} />;
}

/**
 * モニター。実際の映像は持たないので、**「今映像が出ているか」だけ**を
 * 画面のプレースホルダー絵（山と太陽）の有無で示す（design.md §4.19）。
 * `kind: "lamp"` の点灯条件（両端が電源に届いているか）をそのまま流用する
 * ——プロジェクターと違って `lit` が唯一の観測対象になる。
 */
function MonitorVisual({ simulation }: Pick<BodyProps, "simulation">) {
  const lit = simulation?.lit ?? false;

  return (
    <div className={styles.stack}>
      <svg
        className={styles.symbol}
        width="72"
        height="52"
        viewBox="0 0 72 52"
        aria-hidden
      >
        <rect
          className={styles.monitorScreen}
          data-lit={lit ? "true" : undefined}
          x="4"
          y="4"
          width="64"
          height="36"
          rx="2"
        />
        {/*
          表示中だけ見せる、映像の代わりのプレースホルダー（山と太陽）。
          複数のモニターを置いても衝突しないよう、id 付きの <clipPath> は
          使わず、座標を画面の枠（x: 4–68, y: 4–40）の内側に収めるだけにする。
        */}
        {lit && (
          <g className={styles.monitorPicture}>
            <circle cx="50" cy="15" r="4" />
            <path d="M8 34 L22 20 L30 28 L42 14 L64 34 Z" />
          </g>
        )}
        <path className={styles.monitorStand} d="M30 40 L42 40 L38 47 L34 47 Z" />
        <line x1="24" y1="48" x2="48" y2="48" />
      </svg>
      <span className={styles.monitorCaption} data-lit={lit ? "true" : undefined}>
        {lit ? "表示中" : "非表示"}
      </span>
    </div>
  );
}

/**
 * VP コントローラー。**プロジェクターの投影 ON/OFF は電気的には持たない**
 * （実機の投影 ON/OFF はシリアルコマンドで行い、本アプリは通信の中身を
 * 扱わない・design.md §4.19・§6）ので、プロジェクターの見た目でそれを
 * 示すことはできない。代わりに、**コイルの励磁＝プロジェクターへ ON
 * コマンド送信中**（design.md §4.19）を `RelayBody` と同じコイル記号で
 * 見せる —— 接点を持たないので `ContactDiagram` は出さない。
 *
 * 励磁は「操作卓のボタンを倒している間」の状態であって、投影が持続して
 * いるかどうかの主張ではないため、キャプションも「送信中」という
 * 言い方に留める。
 */
function VpControllerVisual({ simulation }: Pick<BodyProps, "simulation">) {
  const energized = simulation?.energized ?? false;

  return (
    <div className={styles.stack}>
      <svg
        className={styles.symbol}
        width="52"
        height="26"
        viewBox="0 0 52 26"
        aria-hidden
      >
        <line x1="0" y1="13" x2="10" y2="13" />
        <rect
          className={styles.relayCoil}
          data-energized={energized ? "true" : undefined}
          x="10"
          y="5"
          width="32"
          height="16"
          rx="2"
        />
        <line x1="42" y1="13" x2="52" y2="13" />
      </svg>
      <span className={energized ? styles.energizedCaption : styles.caption}>
        {energized ? "プロジェクターへ ON コマンド送信中" : "ON コマンド未送信"}
      </span>
    </div>
  );
}

/**
 * プロジェクター。**投影の ON/OFF は電気的に持たない**（design.md §4.19）
 * ので、`lit`（ランプ）や `energized`（コイル）のような、それを主張する
 * 値は読まない。代わりに `simulation.powered`（design.md §5.20）——
 * 一次側の AC100V が来ていて USB 出力が実際に成立しているか——を、
 * 実機の電源ランプに相当する表示灯として見せる。
 *
 * `LampBody` の `.lampGlass` をそのまま流用する。**新しい色や図記号を
 * 増やさない** —— 「電源が来ている」という同じ意味を、既存の点灯表現の
 * 語彙で示すだけで足りる。
 */
function ProjectorVisual({ simulation }: Pick<BodyProps, "simulation">) {
  const powered = simulation?.powered ?? false;

  return (
    <div className={styles.stack}>
      <svg
        className={styles.symbol}
        width="72"
        height="40"
        viewBox="0 0 72 40"
        aria-hidden
      >
        <rect x="4" y="8" width="52" height="24" rx="3" />
        <circle cx="62" cy="20" r="7" />
        <circle
          className={styles.lampGlass}
          data-lit={powered ? "true" : undefined}
          data-color="green"
          cx="12"
          cy="28"
          r="3"
        />
      </svg>
      <span className={powered ? styles.energizedCaption : styles.caption}>
        電源{powered ? " ON" : " OFF"}
      </span>
    </div>
  );
}

/**
 * 電動スクリーン。上昇・停止・下降は互いに独立した補助コイル
 * （design.md §5.21）なので、3 つを別々のインジケーターで示す。
 *
 * **実際の生地の高さ（位置）は持たない。** タイマーの限時と調光のフェード
 * 以外の時間は扱わない方針（design.md §6）なので、「上昇中／下降中」は
 * 縞模様が流れるアニメーションで示すだけにとどめ、どこまで上がったかという
 * 状態は保存も計算もしない。停止すれば縞も止まる。
 */
function ScreenVisual({ simulation }: Pick<BodyProps, "simulation">) {
  const energized = simulation?.auxCoilsEnergized;
  const up = energized?.has("up") ?? false;
  const down = energized?.has("down") ?? false;
  const stop = energized?.has("stop") ?? false;
  const moving = up ? "up" : down ? "down" : undefined;

  return (
    <div className={styles.stack}>
      <div className={styles.screenCase} aria-hidden />
      <div
        className={styles.screenFabric}
        data-moving={moving}
        aria-hidden
      />
      <div className={styles.screenIndicators}>
        <span className={styles.screenIndicator} data-active={up || undefined}>
          ▲
        </span>
        <span className={styles.screenIndicator} data-active={stop || undefined}>
          ■
        </span>
        <span className={styles.screenIndicator} data-active={down || undefined}>
          ▼
        </span>
      </div>
    </div>
  );
}
