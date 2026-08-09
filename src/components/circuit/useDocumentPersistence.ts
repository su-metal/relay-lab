"use client";

/**
 * LocalStorage への保存・復元（design.md §7・§8.4）。
 *
 * `useSimulationSync` と同じく **駆動する場所を 1 箇所に集約する**ためのフック。
 * 各コンポーネントが思い思いに書き込むと、同じ回路を何度も直列化したり、
 * 読み込み途中の空の回路で上書きしたりする。
 *
 * 保存するのは `CircuitDocument` だけ。`running` / `pressedSwitches` /
 * `SimulationResult` は `simulationStore` にあり、ここからは見えない。
 */

import { useReactFlow } from "@xyflow/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { componentRegistry } from "@/circuit/definitions";
import {
  CIRCUIT_FILE_MIME,
  circuitFileName,
  serializeDocumentToFile,
} from "@/circuit/persistence/document-file";
import {
  getDocumentStorage,
  parseDocument,
  readStoredDocument,
  writeStoredDocument,
} from "@/circuit/persistence/document-storage";
import { useCircuitStore } from "@/store/circuitStore";

/**
 * 書き込みを待つ時間。
 *
 * 保存の引き金は `document` の変化なので、パンやドラッグ中は毎フレーム来る。
 * 直列化と `setItem` を毎フレーム走らせるとキャンバスが目に見えて重くなるため、
 * 操作が止まってからまとめて 1 回書く。
 */
const SAVE_DELAY_MS = 500;

export type PersistenceStatus =
  /** 初回の読み込み中 */
  | "loading"
  /** 保存済み（LocalStorage の内容が画面と一致している） */
  | "saved"
  /** 変更あり。まもなく書き込む */
  | "pending"
  /** ストレージを使えない環境（プライベートモードなど） */
  | "unavailable"
  /** 書き込みに失敗した（容量超過など） */
  | "error";

export type PersistenceState = {
  status: PersistenceStatus;
  /** 読み込み時に捨てた要素の理由。そのまま画面に出せる日本語 */
  notices: readonly string[];
  dismissNotices: () => void;

  /** いまの回路を JSON ファイルとしてダウンロードする */
  exportToFile: () => void;
  /**
   * JSON ファイルから回路を読み込み、いまの回路を**置き換える。**
   * 置き換えてよいかの確認は呼び出し側（操作バー）が済ませておくこと。
   */
  importFromFile: (file: File) => Promise<void>;
};

export function useDocumentPersistence(): PersistenceState {
  const document = useCircuitStore((state) => state.document);
  const replaceDocument = useCircuitStore((state) => state.replaceDocument);
  const { setViewport } = useReactFlow();

  const [status, setStatus] = useState<PersistenceStatus>("loading");
  const [notices, setNotices] = useState<readonly string[]>([]);

  /** 初回読み込みが済むまで書き込まない。空の回路で保存を潰さないため */
  const loaded = useRef(false);

  useEffect(() => {
    const storage = getDocumentStorage();
    if (!storage) {
      setStatus("unavailable");
      setNotices(["このブラウザでは保存が使えません（回路は保持されません）。"]);
      return;
    }

    const outcome = readStoredDocument(storage, componentRegistry);
    if (outcome.status === "loaded") {
      replaceDocument(outcome.document);
      // 保存時の表示位置に戻す。`defaultViewport` は初回マウントでしか効かず、
      // 読み込みはその後に起きるので React Flow へ直接指示する必要がある
      void setViewport(outcome.document.viewport);
      setNotices(outcome.dropped);
    } else if (outcome.status === "invalid") {
      // 壊れた保存データは捨てて空の回路から始める。消すのは次の保存時で、
      // ここで削除すると「読めなかった」ことを確認する手段が無くなる
      setNotices([`保存データを復元できませんでした（${outcome.reason}）`]);
    }

    loaded.current = true;
    setStatus("saved");
  }, [replaceDocument, setViewport]);

  useEffect(() => {
    if (!loaded.current) return;

    setStatus((current) => (current === "unavailable" ? current : "pending"));

    const timer = setTimeout(() => {
      const storage = getDocumentStorage();
      if (!storage) {
        setStatus("unavailable");
        return;
      }
      setStatus(writeStoredDocument(storage, document) ? "saved" : "error");
    }, SAVE_DELAY_MS);

    return () => clearTimeout(timer);
  }, [document]);

  const dismissNotices = useCallback(() => setNotices([]), []);

  /**
   * Blob を一時 URL にして `<a download>` をクリックする。
   *
   * **`window.document` と書くのは必須。** このフックのスコープでは `document` が
   * 回路ドキュメント（`CircuitDocument`）を指しており、素で書くと DOM ではなく
   * 回路の方を掴む。型が付いているので落ちるが、間違えやすいので明示する。
   */
  const exportToFile = useCallback(() => {
    const blob = new Blob([serializeDocumentToFile(document)], {
      type: CIRCUIT_FILE_MIME,
    });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = circuitFileName();
    anchor.click();
    // クリックは同期なので、この時点で解放してよい（保持し続けるとリークする）
    URL.revokeObjectURL(url);
  }, [document]);

  /**
   * 読み込みは LocalStorage からの復元と同じ経路を通す（`parseDocument`）。
   * 未知の部品定義や存在しない端子は捨てられ、理由が `notices` に出る。
   */
  const importFromFile = useCallback(
    async (file: File) => {
      let raw: string;
      try {
        raw = await file.text();
      } catch {
        setNotices([`${file.name} を読み取れませんでした。`]);
        return;
      }

      const outcome = parseDocument(raw, componentRegistry);
      if (outcome.status === "empty") {
        setNotices([`${file.name} は空のファイルでした。`]);
        return;
      }
      if (outcome.status === "invalid") {
        setNotices([
          `${file.name} を読み込めませんでした（${outcome.reason}）`,
        ]);
        return;
      }

      replaceDocument(outcome.document);
      void setViewport(outcome.document.viewport);
      // 成功も必ず知らせる。捨てた要素が無いと通知が一切出ず、
      // 「押したのに何も起きていない」のか「読み込めた」のか区別が付かない
      setNotices([`${file.name} を読み込みました。`, ...outcome.dropped]);
    },
    [replaceDocument, setViewport],
  );

  return { status, notices, dismissNotices, exportToFile, importFromFile };
}
