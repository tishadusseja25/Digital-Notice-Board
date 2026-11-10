import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    globalSetup: ["./tests/globalSetup.ts"],
    // The first run downloads a MongoDB binary, which can take a while.
    hookTimeout: 120_000,
  },
});
