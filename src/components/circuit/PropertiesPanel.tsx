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
import type {
  ComponentInspection,
  ContactInspection,
} from "@/circuit/adapter/inspection";
import { componentDefinitions, componentRegistry } from "@/circuit/definitions";
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

import styles from "./PropertiesPanel.module.css";

export function PropertiesPanel() {
  const document = useCircuitStore((state) => state.document);
  const selectedComponentIds = useCircuitStore(
    (state) => state.selectedComponentIds,
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

  const selectedId = selectedComponentIds[0];
  const inspection = useMemo(
    () =>
      inspectComponent(
        document,
        componentRegistry,
        result,
        pressedSwitches,
        selectedId,
      ),
    [document, result, pressedSwitches, selectedId],
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
          onLabelChange={(label) =>
            setComponentLabel(inspection.instance.id, label)
          }
          onFlip={() => flipComponents([inspection.instance.id])}
          onReplace={(definition) =>
            replaceComponentDefinition(inspection.instance.id, definition)
          }
        />
      )}
    </aside>
  );
}

type DetailsProps = {
  inspection: ComponentInspection;
  onLabelChange: (label: string) => void;
  onFlip: () => void;
  onReplace: (definition: ComponentDefinition) => void;
};

function ComponentDetails({
  inspection,
  onLabelChange,
  onFlip,
  onReplace,
}: DetailsProps) {
  const { instance, definition, device, contacts, terminals } = inspection;
  const running = device !== undefined;
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

/** 接点 1 個。COM がどちらへ倒れているかを 1 行で読ませる */
function ContactRow({ inspection }: { inspection: ContactInspection }) {
  const { contact, order, closed } = inspection;

  return (
    <li className={styles.contact}>
      <span className={styles.contactName}>第{order}接点</span>
      <span className={styles.contactPairs}>
        <ContactPair
          role="COM–NC"
          terminals={`${contact.commonTerminal}–${contact.ncTerminal}`}
          closed={closed === undefined ? undefined : closed === "nc"}
        />
        <ContactPair
          role="COM–NO"
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
      return (
        <section className={styles.section}>
          <h3 className={styles.heading}>コイル</h3>
          <dl className={styles.rows}>
            <Row name="定格">
              {coil.currentType}
              {coil.voltage}V
            </Row>
            <Row name="端子">
              + {coil.positiveTerminal} / − {coil.negativeTerminal}
            </Row>
            <Row name="極性">{COIL_POLARITY_LABELS[coil.polarity]}</Row>
            <Row name="状態">
              <StateBadge
                on={device?.energized}
                onLabel="励磁中"
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
                onLabel="押下中"
                offLabel="復帰"
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
