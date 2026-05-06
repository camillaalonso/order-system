import type { Prisma } from "@prisma/client";
import type { UserRepository } from "../../application/users/UserRepository.js";

export class PrismaUserRepository implements UserRepository {
  async reserveCash(id: string, amount: number, tx: Prisma.TransactionClient): Promise<boolean> {
    const result = await tx.user.updateMany({
      where: { id, cashBalance: { gte: amount.toString() } },
      data: {
        cashBalance: { decrement: amount.toString() },
        reservedCash: { increment: amount.toString() },
      },
    });
    return result.count === 1;
  }

  async consumeReservedCash(
    id: string,
    amount: number,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const result = await tx.user.updateMany({
      where: { id, reservedCash: { gte: amount.toString() } },
      data: { reservedCash: { decrement: amount.toString() } },
    });
    if (result.count !== 1) {
      throw new Error(`consumeReservedCash failed: user=${id} amount=${amount}`);
    }
  }

  async releaseReservedCash(
    id: string,
    amount: number,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const result = await tx.user.updateMany({
      where: { id, reservedCash: { gte: amount.toString() } },
      data: {
        cashBalance: { increment: amount.toString() },
        reservedCash: { decrement: amount.toString() },
      },
    });
    if (result.count !== 1) {
      throw new Error(`releaseReservedCash failed: user=${id} amount=${amount}`);
    }
  }

  async creditCash(id: string, amount: number, tx: Prisma.TransactionClient): Promise<void> {
    await tx.user.update({
      where: { id },
      data: { cashBalance: { increment: amount.toString() } },
    });
  }
}
