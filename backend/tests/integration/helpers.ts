import { prisma } from "../../src/infra/db/prisma.js";
import { buildServer } from "../../src/http/server.js";
import type { Quote, QuotationClient } from "../../src/infra/quotation/QuotationClient.js";
import { ExecuteOrder } from "../../src/application/orders/ExecuteOrder.js";
import { PrismaOrderRepository } from "../../src/infra/db/PrismaOrderRepository.js";
import { PrismaPositionRepository } from "../../src/infra/db/PrismaPositionRepository.js";
import { PrismaUserRepository } from "../../src/infra/db/PrismaUserRepository.js";
import { PrismaTransactionRunner } from "../../src/infra/db/PrismaTransactionRunner.js";
import { runWorkerTick } from "../../src/worker/runWorkerTick.js";
import { logger } from "../../src/lib/logger.js";

export const TEST_USER = "user-001";
export const OTHER_USER = "user-999";

export async function truncateAll(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "orders", "positions", "users", "assets" RESTART IDENTITY CASCADE',
  );
}

export async function seedAssets(): Promise<void> {
  await prisma.asset.createMany({
    data: [
      { symbol: "ITUB4", name: "Itaú Unibanco PN", referencePrice: "32.80" },
      { symbol: "USDC", name: "USD Coin", referencePrice: "5.50" },
      { symbol: "BTC", name: "Bitcoin", referencePrice: "350000.00" },
    ],
  });
}

export async function seedUser(opts?: {
  id?: string;
  cashBalance?: string;
  reservedCash?: string;
}): Promise<void> {
  await prisma.user.create({
    data: {
      id: opts?.id ?? TEST_USER,
      name: "Test User",
      cashBalance: opts?.cashBalance ?? "10000.00",
      reservedCash: opts?.reservedCash ?? "0.00",
    },
  });
}

export async function seedPosition(opts: {
  userId?: string;
  symbol: string;
  quantity: string;
  reservedQuantity?: string;
  avgPrice: string;
}): Promise<void> {
  await prisma.position.create({
    data: {
      userId: opts.userId ?? TEST_USER,
      symbol: opts.symbol,
      quantity: opts.quantity,
      reservedQuantity: opts.reservedQuantity ?? "0",
      avgPrice: opts.avgPrice,
    },
  });
}

export async function seedDefault(): Promise<void> {
  await truncateAll();
  await seedAssets();
  await seedUser();
  await seedPosition({ symbol: "ITUB4", quantity: "100", avgPrice: "30.00" });
  await seedPosition({ symbol: "USDC", quantity: "50", avgPrice: "3.94" });
}

export class StubQuotationClient implements QuotationClient {
  constructor(private readonly priceMap: Record<string, number | null> = {}) {}

  async getQuote(symbol: string): Promise<Quote | null> {
    const price = this.priceMap[symbol];
    if (price == null) return null;
    return { symbol, price, fetchedAt: new Date() };
  }
}

export function makeApp(quotationClient: QuotationClient = new StubQuotationClient()) {
  return buildServer({ quotationClient });
}

/**
 * Roda um tick do worker (claim + execute), igual ao loop do `src/worker.ts`.
 * Recebe um QuotationClient pra controlar re-quote determinístico nos testes.
 */
export function processOne(
  quotationClient: QuotationClient = new StubQuotationClient(),
): Promise<boolean> {
  const orders = new PrismaOrderRepository(prisma);
  const positions = new PrismaPositionRepository(prisma);
  const users = new PrismaUserRepository();
  const runner = new PrismaTransactionRunner(prisma);
  const executeOrder = new ExecuteOrder(users, positions, orders, quotationClient);
  return runWorkerTick({
    orders,
    users,
    positions,
    runner,
    executeOrder,
    logger,
  });
}

export function authHeaders(userId: string = TEST_USER): Record<string, string> {
  return { "x-user-id": userId };
}
