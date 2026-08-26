import { inspectContacts } from "@/circuit/adapter/inspection";
import type { DeviceSimulationState } from "@/circuit/adapter/simulation-view";
import { operationKey } from "@/circuit/types";
import type { RelayDefinition } from "@/circuit/types";
import { contactSummaryOf, shortOperationLabel } from "@/lib/component-display";
import { useSimulationStore } from "@/store/simulationStore";

import { ContactDiagram } from "./ContactDiagram";
import styles from "./bodies.module.css";

type Props = {
  /** `null` なら接点も操作子も持たない部品（呼び出し側の型番分岐ではなく、電気的な定義の有無） */
  relay: RelayDefinition | null;
  componentId: string;
  simulation?: DeviceSimulationState;
};

/**
 * 接点の図記号・連続量の操作子（フェーダー）・入り切りの操作子（ボタン）・
 * 接点構成のキャプション（design.md §4.16・§4.17・§8.11）。
 *
 * **`RelayBody`（コイル付き）と `DimmerBody` の `kind: "relay"` 側
 * （カットリレー・操作卓・design.md §4.17）が共用する。** どちらも
 * `RelayDefinition` を持つ点は同じで、違うのは本体上部に描く図記号
 * （コイル付きの巻線か、調光の斜線）だけ。ここを 2 回書くと、
 * フェーダーや接点の判定を片方だけ直す事故が起きる。
 *
 * **コイルの図記号はここに含めない。** `relay.coil` が無い部品
 * （カットリレー・操作卓）にコイル記号を描くと、実機に無い端子を
 * 主張することになる（CLAUDE.md 設計原則 6）。呼び出し側が自分の
 * 図記号だけを描き、この先を任せる。
 */
export function RelayControls({ relay, componentId, simulation }: Props) {
  const toggleOperation = useSimulationStore((state) => state.toggleOperation);
  const operatedDevices = useSimulationStore((state) => state.operatedDevices);
  const deviceLevels = useSimulationStore((state) => state.deviceLevels);
  const setOperationLevel = useSimulationStore((state) => state.setOperationLevel);
  const running = useSimulationStore((state) => state.running);

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
    <>
      {/* 接点の図記号（design.md §8.11）。タイマーと共有する */}
      <ContactDiagram contacts={contacts} />

      {/*
        連続量の操作子（フェーダー・design.md §4.17・§8.16）。**実行中だけ出す** ——
        停止中に動かせると、盤の状態が配線の一部であるかのように見える。
        倒した位置は保存しない（§4.7 と同じ）。
        実機の操作卓と同じく**縦スライド**（`writing-mode` で 90°回す）。
        名前・トラック・値を縦に積んだチャンネルを横に並べる。
      */}
      {running && levelOperations.length > 0 && (
        <span className={styles.faders}>
          {levelOperations.map((operation) => {
            const key = operationKey(componentId, operation.id);
            const percent =
              deviceLevels.get(key) ?? operation.defaultPercent ?? 0;
            return (
              <label key={operation.id} className={styles.fader}>
                <span className={styles.faderName}>
                  {shortOperationLabel(operation.label)}
                </span>
                <input
                  // React Flow はこのクラスの付いた要素の上でドラッグを始めない
                  className={`${styles.faderRange} nodrag`}
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={percent}
                  aria-label={operation.label}
                  aria-orientation="vertical"
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
    </>
  );
}
