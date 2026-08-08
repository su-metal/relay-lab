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
  getDocumentStorage,
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

  return { status, notices, dismissNotices };
}
