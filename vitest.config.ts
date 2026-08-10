import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    testTimeout: 30000,
    include: ["test/**/*.test.ts"],
    server: {
      deps: {
        inline: ["mavenagi"],
      },
    },
  },
});
