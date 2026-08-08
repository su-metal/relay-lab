import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * エンジンは React / Zustand / React Flow を import しない純粋関数なので DOM は不要。
 * コンポーネントテストが必要になった時点で jsdom を追加する。
 */
export default defineConfig({
  resolve: {
    alias: {
      // tsconfig.json の paths と対応させること（エイリアスは "@/*" の 1 本だけ）
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
