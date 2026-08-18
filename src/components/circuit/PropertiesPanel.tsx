"use client";

/**
 * プロパティパネル（右カラム・design.md §8.3）。
 *
 * 選択した部品の「中身が読める」ことが役割。静的な仕様（型番・コイル電圧・
 * 接点構成・実端子番号）と、シミュレーション中にしか決まらない状態
 * （励磁 / 接点の倒れている側 / 端子の電位）を 1 枚に並べる。
 *
 * 判定は一切ここに書かない。すべて `adapter/inspection.ts` が返す
 * `ComponentInspection` を読むだけなので、UI を起動せずに Vitest で検証できる。
 */

import { useMemo } from "react";
import type { ReactNode } from "react";

import { inspectComponent } from "@/circuit/adapter/inspection";
import {
  explainLoadPath,
  trimLoadEnds,
  trimStartPath,
} from "@/circuit/adapter/load-path";
import { buildSelfHold } from "@/circuit/adapter/self-hold";
import type {
  ComponentInspection,
  ContactInspection,
} from "@/circuit/adapter/inspection";
import type {
  LoadPathExplanation,
  PathBreak,
  PathStep,
} from "@/circuit/adapter/load-path";
import { componentDefinitions, componentRegistry } from "@/circuit/definitions";
import { presetMsOf } from "@/circuit/engine";
import type { ComponentDefinition, ElectricalDefinition } from "@/circuit/types";
import {
  CATEGORY_LABELS,
  COIL_POLARITY_LABELS,
  COIL_POLARITY_NOTES,
  DIODE_BIAS_LABELS,
  DIODE_HINT,
  TERMINAL_ROLE_LABELS,
  WIRE_STATE_LABELS,
  hasRealTerminalNumbers,
} from "@/lib/component-display";
import { useCircuitStore } from "@/store/circuitStore";
import { useSimulationStore } from "@/store/simulationStore";

import { usePathPreview } from "./usePathPreview";
import styles from "./PropertiesPanel.module.css";

export function PropertiesPanel() {
  const document = useCircuitStore((state) => state.document);
  const selectedComponentIds = useCircuitStore(
    (state) => state.selectedComponentIds,
  );
  const setComponentPreset = useCircuitStore(
    (state) => state.setComponentPreset,
  );
  const setComponentLabel = useCircuitStore(
    (state) => state.setComponentLabel,
  );
  const flipComponents = useCircuitStore((state) => state.flipComponents);
  const replaceComponentDefinition = useCircuitStore(
    (state) => state.replaceComponentDefinition,
  );

  const result = useSimulationStore((state) => state.result);
  const pressedSwitches = useSimulationStore((state) => state.pressedSwitches);
  const nowMs = useSimulationStore((state) => state.nowMs);

  /**
   * 自己保持の検出（design.md §5.9）。**選択部品とは無関係**なので、
   * 選択が変わるたびに解き直さないよう `inspection` とは別の useMemo に置く。
   * ここで組まないとキャンバスは紫、パネルは「通電中」と食い違う。
   */
  const selfHold = useMemo(
    () => buildSelfHold(document, componentRegistry, result, pressedSwitches),
    [document, result, pressedSwitches],
  );

  /**
   * 経路確認モードの表示状態（design.md §8.14）。キャンバス・一覧と
   * 同じ 1 回の解を読む（`usePathPreview`）。
   */
  const preview = usePathPreview();

  const selectedId = selectedComponentIds[0];
  const inspection = useMemo(
    () =>
      inspectComponent(
        document,
        componentRegistry,
        result,
        pressedSwitches,
        selectedId,
        selfHold,
        nowMs,
        // 経路確認モードでは静止状態の電位を端子に出す（design.md §8.14）。
        // モード外は空なので、ここに条件を書き写さない
        preview.view.terminalOf,
      ),
    [
      document,
      result,
      pressedSwitches,
      preview,
      selectedId,
      selfHold,
      nowMs,
    ],
  );

  /**
   * 負荷 1 個の経路説明（design.md §5.11）。
   *
   * `inspection` とは別に組むのは、こちらが**経路グラフ**を必要とするため。
   * 部品の中身（接点の倒れている側・端子の電位）はネットだけで読めるが、
   * 「どこを通って励磁しているか」はネットからは復元できない（§5.9 と同じ理由）。
   */
  const loadPath = useMemo(
    () =>
      explainLoadPath(
        document,
        componentRegistry,
        result,
        pressedSwitches,
        selectedId,
        nowMs,
      ),
    [document, result, pressedSwitches, selectedId, nowMs],
  );

  return (
    <aside className={styles.panel} aria-label="プロパティ">
      <h2 className={styles.title}>プロパティ</h2>

      {selectedComponentIds.length > 1 && (
        <p className={styles.empty}>
          {selectedComponentIds.length} 個の部品を選択中です。
        </p>
      )}

      {!inspection ? (
        <p className={styles.empty}>部品を選択すると詳細を表示します。</p>
      ) : (
        <ComponentDetails
          inspection={inspection}
          loadPath={loadPath}
          onLabelChange={(label) =>
            setComponentLabel(inspection.instance.id, label)
          }
          onFlip={() => flipComponents([inspection.instance.id])}
          onReplace={(definition) =>
            replaceComponentDefinition(inspection.instance.id, definition)
          }
          onPresetChange={(presetMs) =>
            setComponentPreset(inspection.instance.id, presetMs)
          }
        />
      )}
    </aside>
  );
}

type DetailsProps = {
  inspection: ComponentInspection;
  /** 負荷（コイル / ランプ）のときだけ入る。停止中・負荷以外は null */
  loadPath: LoadPathExplanation | null;
  onLabelChange: (label: string) => void;
  onFlip: () => void;
  onReplace: (definition: ComponentDefinition) => void;
  /** タイマーの設定時間（ms）。タイマー以外では呼ばれない */
  onPresetChange: (presetMs: number) => void;
};

function ComponentDetails({
  inspection,
  loadPath,
  onLabelChange,
  onFlip,
  onReplace,
  onPresetChange,
}: DetailsProps) {
  const { instance, definition, device, contacts, terminals } = inspection;
  const running = device !== undefined;
  // タイマーの限時設定（design.md §5.13）。持たない部品では欄ごと出さない
  const delay =
    definition.electrical.kind === "relay"
      ? definition.electrical.delay
      : undefined;
  // 交換候補は同じカテゴリ内だけ（design.md §8.3）。カテゴリを跨ぐと
  // ElectricalDefinition.kind ごと変わり、部品交換ではなく作り直しになる
  const replaceCandidates = componentDefinitions.filter(
    (candidate) =>
      candidate.category === definition.category &&
      candidate.id !== definition.id,
  );

  return (
    <div className={styles.sections}>
      <section className={styles.section}>
        <label className={styles.labelField}>
          <span className={styles.fieldName}>名前</span>
          <input
            className={styles.labelInput}
            type="text"
            value={instance.label ?? ""}
            placeholder="RY1"
            maxLength={24}
            onChange={(event) => onLabelChange(event.target.value)}
            // 前後の空白はここで落とす。onChange で trim すると
            // 途中の空白入力が消えて打てなくなる（circuitStore 参照）
            onBlur={(event) => onLabelChange(event.target.value.trim())}
          />
        </label>

        {/*
          タイマーの設定時間（design.md §5.13）。**秒で入力させる。**
          内部は ms だが、実機のダイヤルは秒（や分）なので、
          「3000」と打たせると単位を取り違える。

          ラベルと違い Undo の対象にしている —— 設定時間は回路の動きそのものを
          変えるので、間違えたときに戻せないと困る（`circuitStore` 参照）。
        */}
        {delay && (
          <label className={styles.labelField}>
            <span className={styles.fieldName}>
              {delay.mode === "off-delay" ? "限時復帰" : "限時動作"}
            </span>
            <span className={styles.presetField}>
              <input
                className={styles.presetInput}
                type="number"
                inputMode="decimal"
                step={0.1}
                min={delay.minPresetMs / 1000}
                max={delay.maxPresetMs / 1000}
                value={presetMsOf(delay, instance.presetMs) / 1000}
                onChange={(event) => {
                  const seconds = Number(event.target.value);
                  // 入力途中の空欄・記号だけの状態では書き込まない。
                  // 範囲外は circuitStore が上下限へ丸める
                  if (!Number.isFinite(seconds)) return;
                  onPresetChange(Math.round(seconds * 1000));
                }}
              />
              <span className={styles.presetUnit}>秒</span>
            </span>
          </label>
        )}

        {/*
          左右反転（design.md §8.1）。端子の出る辺が入れ替わるので、
          電源を右に置く図面でも配線が本体を横切らずに済む。
          押している状態が続く操作ではないので aria-pressed は使わない
        */}
        <div className={styles.actions}>
          <button type="button" className={styles.action} onClick={onFlip}>
            左右反転（F）
          </button>
          {instance.flipped && (
            <span className={styles.flippedBadge}>反転中</span>
          )}
        </div>

        {/*
          部品交換。接続（componentId + terminalId 参照）はインスタンス ID を
          変えずに定義だけ差し替えるので維持される。差し替え先に無い端子への
          配線だけが黙って外れる（同じカテゴリ内限定・design.md §7 / §8.3）
        */}
        {replaceCandidates.length > 0 && (
          <label className={styles.labelField}>
            <span className={styles.fieldName}>部品交換</span>
            <select
              className={styles.labelInput}
              value=""
              onChange={(event) => {
                const target = replaceCandidates.find(
                  (candidate) => candidate.id === event.target.value,
                );
                if (target) onReplace(target);
              }}
            >
              <option value="" disabled>
                交換先を選択…
              </option>
              {replaceCandidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.model}
                </option>
              ))}
            </select>
          </label>
        )}

        <dl className={styles.rows}>
          <Row name="メーカー">{definition.manufacturer ?? "—"}</Row>
          <Row name="型番">{definition.model}</Row>
          <Row name="種別">{CATEGORY_LABELS[definition.category]}</Row>
          <Row name="端子データ">
            {!hasRealTerminalNumbers(definition) ? (
              // 実端子番号が存在しない汎用部品。検証の対象そのものが無い
              "実端子番号なし"
            ) : definition.verified ? (
              "検証済み"
            ) : (
              <span className={styles.unverified}>未検証</span>
            )}
          </Row>
          {definition.source && (
            <Row name="出典">
              <span className={styles.source}>{definition.source}</span>
            </Row>
          )}
        </dl>
      </section>

      <ElectricalSection
        electrical={definition.electrical}
        inspection={inspection}
      />

      {loadPath && <LoadPathSection explanation={loadPath} />}

      {contacts.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.heading}>接点</h3>
          <ul className={styles.contacts}>
            {contacts.map((contact) => (
              <ContactRow key={contact.contact.id} inspection={contact} />
            ))}
          </ul>
          {!running && (
            <p className={styles.hint}>
              ▶ 実行すると導通している側がここに表示されます。
            </p>
          )}
        </section>
      )}

      <section className={styles.section}>
        <h3 className={styles.heading}>端子（{terminals.length}）</h3>
        <ul className={styles.terminals}>
          {terminals.map(({ terminal, state }) => (
            <li key={terminal.id} className={styles.terminal}>
              <span className={styles.terminalLabel} data-state={state}>
                {terminal.label}
              </span>
              <span className={styles.terminalRole}>
                {TERMINAL_ROLE_LABELS[terminal.role]}
              </span>
              <span className={styles.terminalState}>
                {state ? WIRE_STATE_LABELS[state] : "—"}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/**
 * 通電経路と、通電しない理由（design.md §5.11）。
 *
 * 判定は `adapter/load-path.ts` が済ませてある。ここがやるのは、
 * 返ってきた区間を上から順に並べることと、**言い回しをコイル / ランプで
 * 分けること**（"励磁" と "点灯"）だけ。
 */
function LoadPathSection({
  explanation,
}: {
  explanation: LoadPathExplanation;
}) {
  const verb = explanation.kind === "relay" ? "励磁" : "点灯";

  if (explanation.active) {
    const { supply, back } = trimLoadEnds(explanation);
    const start = explanation.startPath;
    const startSteps = trimStartPath(explanation);
    const releases = explanation.releases ?? [];
    // 落ちる操作と、落ちない操作を言い分ける（design.md §5.12）
    const releasing = releases.filter((entry) => entry.releases);
    const ineffective = releases.filter((entry) => !entry.releases);

    return (
      <>
        <section className={styles.section}>
          <h3 className={styles.heading}>
            {verb}している経路{start && "（保持）"}
          </h3>
          <ol className={styles.path}>
            {supply.map((step, index) => (
              <PathRow key={`supply-${index}`} step={step} />
            ))}
            {/* 負荷そのもの。ここで電流が仕事をしている */}
            <li className={styles.pathLoad}>
              <span className={styles.pathLoadName}>
                {explanation.kind === "relay" ? "コイル" : "ランプ"}
              </span>
              <span className={styles.pathTerminals}>
                {explanation.inletLabel} → {explanation.outletLabel}
              </span>
            </li>
            {back.map((step, index) => (
              <PathRow key={`back-${index}`} step={step} />
            ))}
          </ol>
          {(explanation.supplyRun?.branched ||
            explanation.returnRun?.branched) && (
            <p className={styles.hint}>
              途中に並列に分かれた区間があるため、一本道には絞れていません。
              分岐した区間は配線上でも電流の向きを出しません。
            </p>
          )}
        </section>

        {/*
          起動経路（design.md §5.12）。**今の経路と切れている場合だけ出る。**
          自己保持を組むと、きっかけを作ったスイッチが起動した瞬間に回路から
          外れ、画面上ではまったく無関係に見える。ここが無いと
          「なぜあのスイッチは灰色なのに、あれで動いたのか」に答えられない
        */}
        {start && (
          <section className={styles.section}>
            <h3 className={styles.heading}>
              {/*
                押しボタンで起動した場合は「切れている」だけでは足りない。
                読み手の問いは「どのボタンで動いたのか」なので、見出しで名指す
              */}
              {start.trigger
                ? `起動した経路（${start.trigger.label} を押している間だけ通ります）`
                : "起動した経路（今は切れています）"}
            </h3>
            <ol className={`${styles.path} ${styles.pathBroken}`}>
              {startSteps.supply.map((step, index) => (
                <PathRow key={`start-${index}`} step={step} />
              ))}
              <li className={`${styles.pathLoad} ${styles.pathLoadBroken}`}>
                <span className={styles.pathLoadName}>
                  {explanation.kind === "relay" ? "コイル" : "ランプ"}
                </span>
                <span className={styles.pathTerminals}>
                  {explanation.inletLabel} → {explanation.outletLabel}
                </span>
              </li>
              {startSteps.back.map((step, index) => (
                <PathRow key={`startback-${index}`} step={step} />
              ))}
            </ol>
            {/*
              同じ部品の接点はまとめて「RY1 の 9–1・10–2」と書く。
              部品名を接点の数だけ繰り返すと、**どこが切れたのかより
              部品名のほうが目立つ**
            */}
            {start.trigger ? (
              <p className={styles.hint}>
                {start.trigger.label} を離した今この道は切れていますが、上の保持
                経路が引き継いでいるため {verb}したままになります。
                {start.breaks.length > 0 && (
                  <>
                    {" "}
                    {verb}した時点で {describeBreaks(start.breaks)}{" "}
                    も開いています。
                  </>
                )}
              </p>
            ) : (
              <p className={styles.hint}>
                {verb}した時点で {describeBreaks(start.breaks)}{" "}
                が開き、この経路は切れました。
              </p>
            )}
          </section>
        )}

        {/* 落とし方（design.md §5.12）。落ちない操作こそが誤解の芯 */}
        {releases.length > 0 && (
          <section className={styles.section}>
            <h3 className={styles.heading}>
              {explanation.kind === "relay" ? "落とす" : "消す"}には
            </h3>
            {releasing.length > 0 ? (
              <ul className={styles.reachList}>
                {releasing.map((entry) => (
                  <li key={entry.componentId} className={styles.gateRow}>
                    <span className={styles.pathName}>{entry.label}</span>
                    <span className={styles.pathTerminals}>を</span>
                    <span className={styles.gateCondition}>{entry.action}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.hint}>
                スイッチの操作では落ちません。配線を外すか、■ で停止してください。
              </p>
            )}
            {ineffective.length > 0 && (
              <p className={styles.hint}>
                ※{" "}
                {ineffective
                  .map((entry) => `${entry.label} を ${entry.concessive}`)
                  .join("、")}
                落ちません。
              </p>
            )}
          </section>
        )}
      </>
    );
  }

  const [first, second] = explanation.reach ?? [];
  return (
    <section className={styles.section}>
      <h3 className={styles.heading}>{verb}しない理由</h3>
      <ul className={styles.reachList}>
        {[first, second].map(
          (terminal) =>
            terminal && (
              <li key={terminal.label} className={styles.reachRow}>
                <span
                  className={styles.terminalLabel}
                  data-state={
                    terminal.expects === "plus" ? "plus" : "zero"
                  }
                >
                  {terminal.label}
                </span>
                <span className={styles.reachText}>
                  {terminal.expects === "plus"
                    ? terminal.reachesPlus
                      ? "+ 側に届いています"
                      : "+ 側に届いていません"
                    : terminal.reachesZero
                      ? "0V 側に届いています"
                      : "0V 側に届いていません"}
                </span>
              </li>
            ),
        )}
      </ul>

      {/*
        0V コモンの繋ぎ忘れ（design.md §5.3）。**接点の話に代えて出す。**
        両端とも「届いています」と出ているのに動かない状態は、接点をいくら
        探しても答えが出ない —— 足りないのは接点ではなく基準。ここで
        「接点を閉じても届きません」と続けると、無い接点を探させることになる。
      */}
      {explanation.supplyMismatch ? (
        <p className={styles.hint}>
          両端は電源に届いていますが、届いている先が<strong>別々の電源</strong>
          です。2 台の 0V どうしがつながっていないため電流の帰り道がありません。
          0V を共通（コモン）にしてください。
        </p>
      ) : explanation.gates && explanation.gates.length > 0 ? (
        <>
          <p className={styles.hint}>閉じれば電源に届く接点：</p>
          <ul className={styles.reachList}>
            {explanation.gates.map((gate) => (
              <li
                key={`${gate.componentId}-${gate.terminalLabels.join("-")}`}
                className={styles.gateRow}
              >
                <span className={styles.pathName}>{gate.label}</span>
                <span className={styles.pathTerminals}>
                  {gate.terminalLabels.join("–")}
                </span>
                <span className={styles.gateCondition}>{gate.condition}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className={styles.hint}>
          {/*
            指摘できる接点が 1 枚も無い状態は 2 通りある。両側とも電源に届いて
            いないなら配線そのものが足りておらず、両側に届いているなら
            接点ではなく極性の問題（§5.7 の coil-polarity-reversed）
          */}
          {first?.reachesPlus || first?.reachesZero || second?.reachesPlus || second?.reachesZero
            ? "接点を閉じても電源に届きません。配線か、コイルの極性を確かめてください。"
            : "どちらの端子も電源につながっていません。配線を確かめてください。"}
        </p>
      )}
    </section>
  );
}

/** 切れた接点を「RY1 の 9–1・10–2」の形にまとめる（同じ部品は 1 度だけ名乗る） */
function describeBreaks(breaks: readonly PathBreak[]): string {
  const byComponent = new Map<string, { label: string; pairs: string[] }>();
  for (const broken of breaks) {
    const entry = byComponent.get(broken.componentId) ?? {
      label: broken.label,
      pairs: [],
    };
    entry.pairs.push(broken.terminalLabels.join("–"));
    byComponent.set(broken.componentId, entry);
  }
  return [...byComponent.values()]
    .map((entry) => `${entry.label} の ${entry.pairs.join("・")}`)
    .join("、");
}

/** 経路の 1 区間。"S1  1 → 2" のように部品名と通る端子を並べる */
function PathRow({ step }: { step: PathStep }) {
  return (
    <li className={styles.pathRow}>
      <span className={styles.pathName}>{step.label}</span>
      <span className={styles.pathTerminals}>
        {step.terminalLabels.join(" → ")}
      </span>
    </li>
  );
}

/** 接点 1 個。COM がどちらへ倒れているかを 1 行で読ませる */
function ContactRow({ inspection }: { inspection: ContactInspection }) {
  const { contact, order, closed } = inspection;

  return (
    <li className={styles.contact}>
      {/* c 接点は「第1接点」、a 接点のみのパワーリレーはカタログの
          数え方に合わせて「第1極」と呼ぶ（design.md §4.8） */}
      <span className={styles.contactName}>
        第{order}
        {contact.ncTerminal === undefined ? "極" : "接点"}
      </span>
      <span className={styles.contactPairs}>
        {/* NC 端子が実機に無い a 接点（G7L など）では行ごと出さない。
            「COM–NC 開」と出すと存在しない端子があるように読めてしまう */}
        {contact.ncTerminal !== undefined && (
          <ContactPair
            role="COM–NC"
            terminals={`${contact.commonTerminal}–${contact.ncTerminal}`}
            closed={closed === undefined ? undefined : closed === "nc"}
          />
        )}
        <ContactPair
          // NC 端子が無い a 接点に「COM–NO」と出すと、実機に無い COM が
          // あるように読める。G7L の 2 端子は対等な a 接点（design.md §4.8）
          role={contact.ncTerminal === undefined ? "a接点" : "COM–NO"}
          terminals={`${contact.commonTerminal}–${contact.noTerminal}`}
          closed={closed === undefined ? undefined : closed === "no"}
        />
      </span>
    </li>
  );
}

function ContactPair({
  role,
  terminals,
  closed,
}: {
  role: string;
  terminals: string;
  /** 停止中は undefined */
  closed?: boolean;
}) {
  return (
    <span
      className={styles.contactPair}
      data-closed={closed === undefined ? undefined : String(closed)}
    >
      <span className={styles.contactRole}>{role}</span>
      <span className={styles.contactTerminals}>{terminals}</span>
      <span className={styles.contactState}>
        {closed === undefined ? "—" : closed ? "導通" : "開"}
      </span>
    </span>
  );
}

/**
 * カテゴリごとの電気仕様と実行時の状態。
 *
 * 分岐は `ElectricalDefinition.kind` の 6 通りだけで、
 * **型番では分岐しない**（CLAUDE.md 設計原則 2）。新型番を足しても
 * このコンポーネントは変わらない。
 */
function ElectricalSection({
  electrical,
  inspection,
}: {
  electrical: ElectricalDefinition;
  inspection: ComponentInspection;
}) {
  const { device, conducting } = inspection;

  switch (electrical.kind) {
    case "power":
      return (
        <section className={styles.section}>
          <h3 className={styles.heading}>電源</h3>
          <dl className={styles.rows}>
            <Row name="電圧">
              {electrical.currentType}
              {electrical.voltage}V
            </Row>
            <Row name="+ 端子">{electrical.positiveTerminal}</Row>
            <Row name="0V 端子">{electrical.zeroTerminal}</Row>
          </dl>
        </section>
      );

    case "relay": {
      const { coil } = electrical.relay;
      /**
       * コイル端子に +/− の印字があるか。
       *
       * **`polarity` では判定できない。** MY2N / MY4N は `polarity: "none"`
       * （逆接でも励磁する）だが、端子 13 / 14 には実際に −/+ の印字がある。
       * 逆に G7L は印字そのものが無い。両者を分けるのは `TerminalRole` で、
       * `coil`（極性なし）か `coil_positive` / `coil_negative` か（design.md §4.8）。
       */
      const coilTerminalsAreLabeled = inspection.terminals.some(
        (t) => t.terminal.role === "coil_positive",
      );
      return (
        <section className={styles.section}>
          <h3 className={styles.heading}>コイル</h3>
          <dl className={styles.rows}>
            <Row name="定格">
              {coil.currentType}
              {coil.voltage}V
            </Row>
            <Row name="端子">
              {/*
                極性の無いコイル（G7L・design.md §4.8）に "+ 0 / − 1" と出すと、
                すぐ下の「極性なし」と矛盾するうえ、実機に無い印字を教えてしまう
              */}
              {coilTerminalsAreLabeled
                ? `+ ${coil.positiveTerminal} / − ${coil.negativeTerminal}`
                : `${coil.positiveTerminal} / ${coil.negativeTerminal}`}
            </Row>
            <Row name="極性">{COIL_POLARITY_LABELS[coil.polarity]}</Row>
            <Row name="状態">
              {/*
                自分の接点で保持している間はそう名乗らせる（design.md §5.9）。
                「励磁中」のままだと、ボタンが保持しているのか接点が保持して
                いるのかがパネルからは読めない
              */}
              <StateBadge
                on={device?.energized}
                onLabel={device?.selfHeld ? "自己保持中" : "励磁中"}
                offLabel="非励磁"
              />
            </Row>
          </dl>
          <p className={styles.hint}>{COIL_POLARITY_NOTES[coil.polarity]}</p>
        </section>
      );
    }

    case "switch":
      return (
        <section className={styles.section}>
          <h3 className={styles.heading}>接点</h3>
          <dl className={styles.rows}>
            <Row name="種別">
              {electrical.contactType === "NO" ? "A接点（NO）" : "B接点（NC）"}
            </Row>
            <Row name="動作">
              {electrical.action === "momentary"
                ? "モーメンタリ"
                : "オルタネート"}
            </Row>
            <Row name="端子">
              {electrical.terminalA}–{electrical.terminalB}
            </Row>
            <Row name="操作">
              <StateBadge
                on={device?.pressed}
                onLabel={
                  electrical.action === "maintained" ? "ON 位置" : "押下中"
                }
                offLabel={
                  electrical.action === "maintained" ? "OFF 位置" : "復帰"
                }
              />
            </Row>
            <Row name="導通">
              <StateBadge on={conducting} onLabel="導通" offLabel="開" />
            </Row>
          </dl>
        </section>
      );

    case "lamp":
      return (
        <section className={styles.section}>
          <h3 className={styles.heading}>ランプ</h3>
          <dl className={styles.rows}>
            <Row name="定格">
              {electrical.currentType}
              {electrical.voltage}V
            </Row>
            <Row name="端子">
              {electrical.terminalA}–{electrical.terminalB}
            </Row>
            <Row name="状態">
              <StateBadge on={device?.lit} onLabel="点灯" offLabel="消灯" />
            </Row>
          </dl>
        </section>
      );

    case "diode": {
      const { diode } = inspection;
      const flyback = diode?.flyback;
      const relay = diode?.flybackRelayName ?? "コイル";
      // 端子 ID（"a" / "k"）ではなく表示ラベル（"A" / "K"）で見せる。
      // リレーは ID がそのまま実端子番号なので差が出ないが、汎用部品は別物
      const labelOf = (terminalId: string) =>
        inspection.terminals.find((entry) => entry.terminal.id === terminalId)
          ?.terminal.label ?? terminalId;
      return (
        <section className={styles.section}>
          <h3 className={styles.heading}>ダイオード</h3>
          <dl className={styles.rows}>
            <Row name="アノード">{labelOf(electrical.anodeTerminal)}</Row>
            <Row name="カソード">{labelOf(electrical.cathodeTerminal)}</Row>
            <Row name="役割">
              {/* 配線の性質なので停止中でも出す（design.md §5.4） */}
              {flyback ? (
                <span
                  className={styles.stateBadge}
                  data-on={String(flyback.orientation === "protective")}
                >
                  {flyback.orientation === "protective"
                    ? `${relay} の逆起電力を吸収`
                    : `${relay} と並列・向きが逆`}
                </span>
              ) : (
                "—"
              )}
            </Row>
            <Row name="向き">
              {device && diode ? (
                DIODE_BIAS_LABELS[diode.bias]
              ) : (
                <span className={styles.idle}>—（停止中）</span>
              )}
            </Row>
          </dl>
          <p className={styles.hint}>
            {flyback?.orientation === "reversed"
              ? `カソード（${labelOf(electrical.cathodeTerminal)}）を ${relay} のコイルの + 側へ向けてください。このままでは通電した瞬間に短絡します。`
              : DIODE_HINT}
          </p>
        </section>
      );
    }

    case "terminal":
      return (
        <section className={styles.section}>
          <h3 className={styles.heading}>端子台</h3>
          <dl className={styles.rows}>
            <Row name="端子">{electrical.terminals.join(" / ")}</Row>
          </dl>
          <p className={styles.hint}>列挙した全端子が常時導通します。</p>
        </section>
      );
  }
}

/**
 * 実行中の 2 値状態。
 * **停止中（`undefined`）は「オフ」ではなく「—」で出す。**
 * 消磁しているのか、そもそも動いていないのかを取り違えさせない（design.md §8.2）。
 */
function StateBadge({
  on,
  onLabel,
  offLabel,
}: {
  on?: boolean;
  onLabel: string;
  offLabel: string;
}) {
  if (on === undefined) return <span className={styles.idle}>—（停止中）</span>;
  return (
    <span className={styles.stateBadge} data-on={String(on)}>
      {on ? onLabel : offLabel}
    </span>
  );
}

function Row({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <dt>{name}</dt>
      <dd>{children}</dd>
    </div>
  );
}
