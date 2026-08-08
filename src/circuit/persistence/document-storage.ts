/**
 * 回路ドキュメントの永続化（design.md §7）。
 *
 * **読み書きの規則はここに閉じ、React も LocalStorage の実体も混ぜない。**
 * `parseDocument()` / `serializeDocument()` は文字列 ⇄ `CircuitDocument` の
 * 純粋関数なので、ブラウザを起動せずに「壊れた保存データを弾けるか」を
 * Vitest で検証できる。実体の `localStorage` を触るのは末尾の 3 関数だけ。
 *
 * 保存対象は `CircuitDocument` のみ。`running` / `pressedSwitches` /
 * `SimulationResult` は保存しない（`simulationStore` 側に分けてある）。
 *
 * **読み込みは常に「壊れているかもしれないデータ」として扱う。**
 * 保存後に定義 ID を変えた／端子を減らしたといった事情で、実在しない部品や
 * 端子を指す JSON はいくらでも生まれる。そのままドキュメントへ通すと
 * エンジンが存在しない端子のネットを引いて静かに壊れるので、
 * **読めない要素は捨てて、捨てた理由を日本語で返す。**
 */

import type {
  CircuitComponentInstance,
  CircuitConnection,
  CircuitDocument,
  ComponentDefinitionRegistry,
  TerminalRef,
} from "@/circuit/types";
import { terminalRefKey } from "@/circuit/types";

/**
 * LocalStorage のキー。
 *
 * 末尾の `v1` は `CircuitDocument.version` と対応する。保存書式を変えたら
 * ここを上げる。旧キーは読まずに放置され、古いデータが新しいコードへ
 * 流れ込むことがない。
 */
export const STORAGE_KEY = "relay-lab:circuit:v1";

const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 1 };

/** 読み込み結果。**「空」と「壊れている」を同じ扱いにしない** */
export type LoadResult =
  | { status: "empty" }
  /** 全体として読めなかった。`reason` はそのまま UI に出せる日本語 */
  | { status: "invalid"; reason: string }
  | {
      status: "loaded";
      document: CircuitDocument;
      /** 捨てた要素の理由。そのまま UI に出せる日本語 */
      dropped: readonly string[];
    };

export type DocumentStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isId = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isPoint = (value: unknown): value is { x: number; y: number } =>
  isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);

const invalid = (reason: string): LoadResult => ({ status: "invalid", reason });

/** 部品の呼び名。ラベルが無ければ ID で出す（メッセージ用） */
const displayName = (label: unknown, id: string): string =>
  typeof label === "string" && label.trim() !== "" ? label.trim() : id;

const readTerminalRef = (value: unknown): TerminalRef | null =>
  isRecord(value) && isId(value.componentId) && isId(value.terminalId)
    ? { componentId: value.componentId, terminalId: value.terminalId }
    : null;

/** ズームは 0 や負値を通すとキャンバスが描画できなくなるので既定へ戻す */
const readViewport = (value: unknown): CircuitDocument["viewport"] => {
  if (!isRecord(value)) return DEFAULT_VIEWPORT;
  const { x, y, zoom } = value;
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return DEFAULT_VIEWPORT;
  if (!isFiniteNumber(zoom) || zoom <= 0) return DEFAULT_VIEWPORT;
  return { x, y, zoom };
};

export const serializeDocument = (document: CircuitDocument): string =>
  JSON.stringify(document);

/**
 * 保存文字列を `CircuitDocument` へ戻す。
 *
 * 部品は **レジストリに存在する `definitionId` だけ**を通す（要件 US-E）。
 * 配線は両端の部品と端子が実在するものだけを通す。判定にレジストリが要るので
 * 引数で受け取る — ここで `componentRegistry` を直接 import すると
 * テストが本番の部品一覧に縛られる。
 */
export const parseDocument = (
  raw: string | null,
  registry: ComponentDefinitionRegistry,
): LoadResult => {
  if (raw === null || raw.trim() === "") return { status: "empty" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return invalid("保存データを JSON として読み取れませんでした。");
  }

  if (!isRecord(parsed)) {
    return invalid("保存データの形式が想定と異なります。");
  }
  if (parsed.version !== 1) {
    return invalid(
      `対応していない保存バージョンです（version: ${String(parsed.version)}）。`,
    );
  }
  if (!Array.isArray(parsed.components) || !Array.isArray(parsed.connections)) {
    return invalid("保存データに部品または配線の一覧がありません。");
  }

  const dropped: string[] = [];
  const components: CircuitComponentInstance[] = [];
  /** 通した部品の ID → その定義が持つ端子 ID。配線の検証に使う */
  const terminalsOf = new Map<string, Set<string>>();

  for (const entry of parsed.components) {
    if (!isRecord(entry) || !isId(entry.id)) {
      dropped.push("部品 1 件を読み込めませんでした（ID がありません）。");
      continue;
    }
    const name = displayName(entry.label, entry.id);

    if (terminalsOf.has(entry.id)) {
      dropped.push(`部品 ${name} を読み込めませんでした（ID が重複しています）。`);
      continue;
    }
    if (!isId(entry.definitionId)) {
      dropped.push(`部品 ${name} を読み込めませんでした（部品定義がありません）。`);
      continue;
    }
    const definition = registry.get(entry.definitionId);
    if (!definition) {
      dropped.push(
        `部品 ${name} を読み込めませんでした（未知の部品定義: ${entry.definitionId}）。`,
      );
      continue;
    }
    if (!isPoint(entry.position)) {
      dropped.push(`部品 ${name} を読み込めませんでした（座標が不正です）。`);
      continue;
    }

    components.push({
      id: entry.id,
      definitionId: entry.definitionId,
      label:
        typeof entry.label === "string" && entry.label.trim() !== ""
          ? entry.label
          : undefined,
      position: { x: entry.position.x, y: entry.position.y },
    });
    terminalsOf.set(
      entry.id,
      new Set(definition.terminals.map((terminal) => terminal.id)),
    );
  }

  const connections: CircuitConnection[] = [];
  const seenConnectionIds = new Set<string>();
  const seenPairs = new Set<string>();

  const exists = (ref: TerminalRef): boolean =>
    terminalsOf.get(ref.componentId)?.has(ref.terminalId) ?? false;

  for (const entry of parsed.connections) {
    if (!isRecord(entry) || !isId(entry.id)) {
      dropped.push("配線 1 本を読み込めませんでした（ID がありません）。");
      continue;
    }
    const from = readTerminalRef(entry.from);
    const to = readTerminalRef(entry.to);
    if (!from || !to) {
      dropped.push(`配線 ${entry.id} を読み込めませんでした（端子の指定が不正です）。`);
      continue;
    }
    // 部品が捨てられていれば、その端子を指す配線も必ず道連れにする
    if (!exists(from) || !exists(to)) {
      dropped.push(
        `配線 ${entry.id} を読み込めませんでした（接続先の端子が存在しません）。`,
      );
      continue;
    }
    if (seenConnectionIds.has(entry.id)) {
      dropped.push(`配線 ${entry.id} を読み込めませんでした（ID が重複しています）。`);
      continue;
    }
    // 同じ端子どうしの二重配線は電気的に無意味（adapter の hasTerminalPair と同じ規則）
    const pair = [terminalRefKey(from), terminalRefKey(to)].sort().join("|");
    if (seenPairs.has(pair)) {
      dropped.push(`配線 ${entry.id} を読み込めませんでした（同じ端子間の重複配線です）。`);
      continue;
    }

    seenConnectionIds.add(entry.id);
    seenPairs.add(pair);
    connections.push({ id: entry.id, from, to });
  }

  return {
    status: "loaded",
    document: {
      version: 1,
      components,
      connections,
      viewport: readViewport(parsed.viewport),
    },
    dropped,
  };
};

/**
 * ブラウザの `localStorage`。取得できなければ `null`。
 *
 * SSR（`window` が無い）に加えて、プライベートモードや設定でストレージが
 * 禁止されている場合は **参照した時点で例外が飛ぶ。** ここで握って
 * 「保存できない環境」として扱い、回路そのものは触れるようにする。
 */
export const getDocumentStorage = (): DocumentStorage | null => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export const readStoredDocument = (
  storage: DocumentStorage,
  registry: ComponentDefinitionRegistry,
): LoadResult => {
  try {
    return parseDocument(storage.getItem(STORAGE_KEY), registry);
  } catch {
    return invalid("保存データを読み出せませんでした。");
  }
};

/** 書き込めれば `true`。容量超過などで失敗したら `false` */
export const writeStoredDocument = (
  storage: DocumentStorage,
  document: CircuitDocument,
): boolean => {
  try {
    storage.setItem(STORAGE_KEY, serializeDocument(document));
    return true;
  } catch {
    return false;
  }
};

export const clearStoredDocument = (storage: DocumentStorage): void => {
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // 消せなくても操作を止める理由にはならない
  }
};
