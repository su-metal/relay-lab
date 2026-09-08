import { operationKey } from "@/circuit/types";
import type { DeviceOperation } from "@/circuit/types";
import { useSimulationStore } from "@/store/simulationStore";

import styles from "./bodies.module.css";

/**
 * 人が倒す操作子（フェーダー・スイッチ）の UI（design.md §4.16・§4.17）。
 *
 * **`RelayDefinition.operations` を持つ機器なら誰でも使う。** コイルで動く
 * リレー（`RelayBody`）も、調光操作卓のようにカテゴリが `dimmer` の機器
 * （`DimmerBody`）も、操作子の描き方は同じ 1 つ —— カテゴリはボディを
 * 選ぶだけで、`kind: "relay"` が持つ操作子の絵まで決めてはいけない
 * （CLAUDE.md 設計原則 2・6 と同じ「型／カテゴリで分岐しない」）。
 *
 * **実行中だけ出す。** 停止中に動かせると、盤の状態が配線の一部で
 * あるかのように見える。倒した位置は保存しない（§4.7 と同じ）。
 */
export function OperationControls({
  operations,
  componentId,
}: {
  operations: readonly DeviceOperation[] | undefined;
  componentId: string;
}) {
  const toggleOperation = useSimulationStore((state) => state.toggleOperation);
  const operatedDevices = useSimulationStore((state) => state.operatedDevices);
  const deviceLevels = useSimulationStore((state) => state.deviceLevels);
  const setOperationLevel = useSimulationStore((state) => state.setOperationLevel);
  const running = useSimulationStore((state) => state.running);

  if (!running || !operations || operations.length === 0) return null;

  /*
   * 操作子を 2 つに分ける（design.md §4.17）。実機の操作卓でもフェーダーと
   * スイッチは別の列にあり、混ぜると倒すつもりでフェーダーを動かしてしまう。
   */
  const levelOperations = operations.filter((entry) => entry.kind === "level");
  const switchOperations = operations.filter((entry) => entry.kind !== "level");

  return (
    <>
      {levelOperations.length > 0 && (
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

      {switchOperations.length > 0 && (
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
    </>
  );
}
