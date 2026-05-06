import { env } from "./lib/env.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./infra/db/prisma.js";
import { PrismaUserRepository } from "./infra/db/PrismaUserRepository.js";
import { PrismaPositionRepository } from "./infra/db/PrismaPositionRepository.js";
import { PrismaOrderRepository } from "./infra/db/PrismaOrderRepository.js";
import { PrismaTransactionRunner } from "./infra/db/PrismaTransactionRunner.js";
import { ExecuteOrder, OrderRejectedError } from "./application/orders/ExecuteOrder.js";
import { buildQuotationClient } from "./infra/quotation/buildQuotationClient.js";
import { runWorkerTick, MAX_EXECUTION_ATTEMPTS } from "./worker/runWorkerTick.js";

let running = true;

async function main() {
  const users = new PrismaUserRepository();
  const positions = new PrismaPositionRepository(prisma);
  const orders = new PrismaOrderRepository(prisma);
  const runner = new PrismaTransactionRunner(prisma);
  const quotationClient = buildQuotationClient(logger);
  const executeOrder = new ExecuteOrder(users, positions, orders, quotationClient);

  logger.info(
    { pollMs: env.WORKER_POLL_INTERVAL_MS, maxAttempts: MAX_EXECUTION_ATTEMPTS },
    "worker started",
  );

  while (running) {
    const processed = await runWorkerTick({
      orders,
      users,
      positions,
      runner,
      executeOrder,
      logger,
    });

    if (!processed) {
      await sleep(env.WORKER_POLL_INTERVAL_MS);
    }
  }

  await prisma.$disconnect();
  logger.info("worker stopped");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

process.on("SIGINT", () => {
  logger.info("SIGINT received, draining...");
  running = false;
});
process.on("SIGTERM", () => {
  logger.info("SIGTERM received, draining...");
  running = false;
});

main().catch((err) => {
  logger.fatal({ err }, "worker crashed");
  process.exit(1);
});

export { OrderRejectedError };
