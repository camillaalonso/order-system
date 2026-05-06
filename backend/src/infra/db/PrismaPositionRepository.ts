import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  PositionRecord,
  PositionRepository,
  PositionState,
} from "../../application/positions/PositionRepository.js";

export class PrismaPositionRepository implements PositionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listByUserId(userId: string): Promise<PositionRecord[]> {
    const rows = await this.prisma.position.findMany({
      where: { userId },
      include: { asset: true },
      orderBy: { symbol: "asc" },
    });
    return rows.map((row) => ({
      symbol: row.symbol,
      name: row.asset.name,
      quantity: row.quantity.toNumber(),
      avgPrice: row.avgPrice.toNumber(),
    }));
  }

  async findByUserAndSymbol(
    userId: string,
    symbol: string,
    tx?: Prisma.TransactionClient,
  ): Promise<PositionState | null> {
    const client = tx ?? this.prisma;
    const row = await client.position.findUnique({
      where: { userId_symbol: { userId, symbol } },
    });
    if (!row) return null;
    return {
      userId: row.userId,
      symbol: row.symbol,
      quantity: row.quantity.toNumber(),
      reservedQuantity: row.reservedQuantity.toNumber(),
      avgPrice: row.avgPrice.toNumber(),
    };
  }

  async upsert(
    userId: string,
    symbol: string,
    quantity: number,
    avgPrice: number,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.position.upsert({
      where: { userId_symbol: { userId, symbol } },
      create: {
        userId,
        symbol,
        quantity: quantity.toString(),
        avgPrice: avgPrice.toString(),
      },
      update: {
        quantity: quantity.toString(),
        avgPrice: avgPrice.toString(),
      },
    });
  }

  async reserveQuantity(
    userId: string,
    symbol: string,
    amount: number,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    const result = await tx.position.updateMany({
      where: {
        userId,
        symbol,
        quantity: { gte: amount.toString() },
      },
      data: {
        quantity: { decrement: amount.toString() },
        reservedQuantity: { increment: amount.toString() },
      },
    });
    return result.count === 1;
  }

  async consumeReservedQuantity(
    userId: string,
    symbol: string,
    amount: number,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const result = await tx.position.updateMany({
      where: {
        userId,
        symbol,
        reservedQuantity: { gte: amount.toString() },
      },
      data: { reservedQuantity: { decrement: amount.toString() } },
    });
    if (result.count !== 1) {
      throw new Error(
        `consumeReservedQuantity failed: user=${userId} symbol=${symbol} amount=${amount}`,
      );
    }
  }

  async releaseReservedQuantity(
    userId: string,
    symbol: string,
    amount: number,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const result = await tx.position.updateMany({
      where: {
        userId,
        symbol,
        reservedQuantity: { gte: amount.toString() },
      },
      data: {
        quantity: { increment: amount.toString() },
        reservedQuantity: { decrement: amount.toString() },
      },
    });
    if (result.count !== 1) {
      throw new Error(
        `releaseReservedQuantity failed: user=${userId} symbol=${symbol} amount=${amount}`,
      );
    }
  }
}
