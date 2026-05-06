import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["./tests/global-setup.ts"],
    pool: "forks",
    forks: { singleFork: true },
    fileParallelism: false,
    testTimeout: 15000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://orders:orders@localhost:5432/orders_test",
      QUOTATION_SERVICE_URL: "http://localhost:3001",
      LOG_LEVEL: "error",
      WORKER_POLL_INTERVAL_MS: "100",
    },
  },
});
