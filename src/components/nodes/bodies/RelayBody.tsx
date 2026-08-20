import { inspectContacts } from "@/circuit/adapter/inspection";
import { operationKey } from "@/circuit/types";
import { contactSummaryOf } from "@/lib/component-display";
import { useSimulationStore } from "@/store/simulationStore";

import { ContactDiagram } from "./ContactDiagram";
import styles from "./bodies.module.css";
import type { BodyProps } from "./types";

/**
 * リレー。コイル記号・接点の図記号・仕様のキャプション。
 *
 * 接点構成は `contactSummaryOf()` から取る。MY2N（2c）でも G7L（1a / 2a）でも
 * このファイルは変わらない。**接点の形も型で決め打たない**（CLAUDE.md 設計原則 6）
 * —— `ncTerminal` の有無だけを見るので、b 接点の無いリレーには b 接点を描かない。
 *
 * どちら側が閉じているかの判定は `adapter/inspection.ts` に任せる。ここで
 * `energized ? "no" : "nc"` と書くと、エンジンが持っている開閉規則の
 * 3 つ目の写しができる。
 *
 * **停止中は静止状態（非励磁）の絵を描く。** これは「消磁している」という
 * 状態の主張ではなく、机の上に置いたリレーがそう見えるという事実
 * （`SwitchBody` が停止中も b 接点を閉じて描くのと同じ）。
 */
export function RelayBody({ definition, componentId, simulation }: BodyProps) {
  const toggleOperation = useSimulationStore((state) => state.toggleOperation);
  const operatedDevices = useSimulationStore((state) => state.operatedDevices);
  const deviceLevels = useSimulationStore((state) => state.deviceLevels);
  const setOperationLevel = useSimulationStore((state) => state.setOperationLevel);
  const running = useSimulationStore((state) => state.running);

  const relay =
    definition.electrical.kind === "relay" ? definition.electrical.relay : null;
  /*
   * 操作子を 2 つに分ける（design.md §4.17）。実機の操作卓でもフェーダーと
   * スイッチは別の列にあり、混ぜると倒すつもりでフェーダーを動かしてしまう。
   */
  const operations = relay?.operations ?? [];
  const levelOperations = operations.filter((entry) => entry.kind === "level");
  const switchOperations = operations.filter((entry) => entry.kind !== "level");
  const energized = simulation?.energized ?? false;
  const contacts = relay
    ? inspectContacts(relay, energized, simulation?.operatedContacts)
    : [];

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

      {/* 接点の図記号（design.md §8.11）。タイマーと共有する */}
      <ContactDiagram contacts={contacts} />

      {/*
        連続量の操作子（フェーダー・design.md §4.17）。**実行中だけ出す** ——
        停止中に動かせると、盤の状態が配線の一部であるかのように見える。
        倒した位置は保存しない（§4.7 と同じ）。
      */}
      {running && levelOperations.length > 0 && (
        <span className={styles.faders}>
          {levelOperations.map((operation) => {
            const key = operationKey(componentId, operation.id);
            const percent =
              deviceLevels.get(key) ?? operation.defaultPercent ?? 0;
            return (
              <label key={operation.id} className={styles.fader}>
                <span className={styles.faderName}>{operation.label}</span>
                <input
                  // React Flow はこのクラスの付いた要素の上でドラッグを始めない
                  className={`${styles.faderRange} nodrag`}
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={percent}
                  aria-label={operation.label}
                  onChange={(event) =>
                    setOperationLevel(
                      componentId,
                      operation.id,
                      Number(event.target.value),
                    )
                  }
                />
                <span className={styles.faderValue}>{Math.round(percent)}%</span>
              </label>
            );
          })}
        </span>
      )}

      {/* 入り切りの操作子（操作卓のボタン・design.md §4.16） */}
      {running && switchOperations.length > 0 && (
        <span className={styles.operations}>
          {switchOperations.map((operation) => {
            const on = operatedDevices.has(
              operationKey(componentId, operation.id),
            );
            return (
              <button
                key={operation.id}
                type="button"
                className={`${styles.pressButton} nodrag`}
                data-pressed={on ? "true" : undefined}
                aria-pressed={on}
                onClick={() => toggleOperation(componentId, operation.id)}
              >
                {operation.label} {on ? "ON" : "OFF"}
              </button>
            );
          })}
        </span>
      )}

      {energized ? (
        <span className={styles.energizedCaption}>励磁中</span>
      ) : (
        relay && (
          <span className={styles.caption}>
            {contactSummaryOf(relay)}
            {/* コイルの無い機器（カットリレー・操作卓）に定格は無い（§4.16） */}
            {relay.coil &&
              ` ／ コイル ${relay.coil.currentType}${relay.coil.voltage}V`}
          </span>
        )
      )}
    </div>
  );
}
