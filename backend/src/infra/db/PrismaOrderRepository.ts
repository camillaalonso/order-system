import type { Order, Prisma, PrismaClient } from "@prisma/client";
import type {
  ListOrdersFilter,
  NewOrder,
  OrderRecord,
  OrderRepository,
} from "../../application/orders/OrderRepository.js";

export class PrismaOrderRepository implements OrderRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: NewOrder, tx: Prisma.TransactionClient): Promise<OrderRecord> {
    const row = await tx.order.create({
      data: {
        userId: input.userId,
        symbol: input.symbol,
        side: input.side,
        quantity: input.quantity.toString(),
        price: input.price.toString(),
        totalAmount: input.totalAmount.toString(),
        status: input.status,
        executedAt: input.executedAt ?? null,
      },
    });
    return toRecord(row);
  }

  async markExecuted(
    id: string,
    executionPrice: number,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const order = await tx.order.findUniqueOrThrow({ where: { id } });
    const executedTotal = round2(order.quantity.toNumber() * executionPrice);
    await tx.order.update({
      where: { id },
      data: {
        status: "EXECUTED",
        executedAt: new Date(),
        price: executionPrice.toString(),
        totalAmount: executedTotal.toString(),
      },
    });
  }

  async claimNextPendingOrder(tx: Prisma.TransactionClient): Promise<OrderRecord | null> {
    const ids = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "orders"
      WHERE "status" = 'PENDING'
      ORDER BY "createdAt"
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;
    if (ids.length === 0) return null;
    const row = await tx.order.findUnique({ where: { id: ids[0].id } });
    return row ? toRecord(row) : null;
  }

  async listByUserId(userId: string, filter?: ListOrdersFilter): Promise<OrderRecord[]> {
    const rows = await this.prisma.order.findMany({
      where: { userId, ...(filter?.status ? { status: filter.status } : {}) },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return rows.map(toRecord);
  }

  async findByIdAndUserId(id: string, userId: string): Promise<OrderRecord | null> {
    const row = await this.prisma.order.findFirst({ where: { id, userId } });
    return row ? toRecord(row) : null;
  }

  async lockById(
    id: string,
    userId: string,
    tx: Prisma.TransactionClient,
  ): Promise<OrderRecord | null> {
    const ids = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "orders"
      WHERE "id" = ${id} AND "userId" = ${userId}
      FOR UPDATE
    `;
    if (ids.length === 0) return null;
    const row = await tx.order.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  }

  async markCanceled(id: string, tx: Prisma.TransactionClient): Promise<void> {
    await tx.order.update({
      where: { id },
      data: { status: "CANCELED" },
    });
  }

  async incrementAttempts(id: string): Promise<number> {
    const updated = await this.prisma.order.update({
      where: { id },
      data: { attempts: { increment: 1 } },
      select: { attempts: true },
    });
    return updated.attempts;
  }

  async markFailed(id: string, reason: string, tx: Prisma.TransactionClient): Promise<void> {
    await tx.order.update({
      where: { id },
      data: { status: "FAILED", failureReason: reason },
    });
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toRecord(row: Order): OrderRecord {
  return {
    id: row.id,
    userId: row.userId,
    symbol: row.symbol,
    side: row.side,
    quantity: row.quantity.toNumber(),
    price: row.price.toNumber(),
    totalAmount: row.totalAmount.toNumber(),
    status: row.status,
    attempts: row.attempts,
    failureReason: row.failureReason,
    createdAt: row.createdAt,
    executedAt: row.executedAt,
  };
}
