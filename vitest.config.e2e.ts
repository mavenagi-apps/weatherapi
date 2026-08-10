import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    include: ["test-e2e/**/*.e2e.ts"],
    setupFiles: ["./test-e2e/setup.ts"],
    testTimeout: 30000,
    server: {
      deps: {
        inline: ["mavenagi"],
      },
    },
  },
});
