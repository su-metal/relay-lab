import { APP_NAME } from "@/lib/app-info";
import styles from "./page.module.css";

export default function Home() {
  return (
    <main className={styles.main}>
      <div className={styles.card}>
        <h1 className={styles.title}>{APP_NAME}</h1>
        <p className={styles.lead}>
          実メーカー・実型番・実端子番号でリレー回路を配線し、動作をシミュレーションする。
        </p>
        <p className={styles.lead}>
          Step 0（プロジェクトセットアップ）まで完了。画面はここから作り込む。
        </p>
        <ul className={styles.steps}>
          <li>Step 1 — 型定義と部品定義</li>
          <li>Step 2 — シミュレーションエンジンと検証回路テスト</li>
          <li>Step 3 — キャンバス・パレット・端子間配線</li>
          <li>Step 4 — エンジン接続（▶実行・配線色・ランプ発光）</li>
        </ul>
      </div>
    </main>
  );
}
