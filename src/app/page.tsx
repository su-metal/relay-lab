import { CircuitWorkspace } from "@/components/circuit/CircuitWorkspace";

/**
 * 画面は 3 カラムのワークスペース 1 枚のみ。
 * React Flow と Zustand を使うため実体はクライアントコンポーネント側にある。
 */
export default function Home() {
  return <CircuitWorkspace />;
}
