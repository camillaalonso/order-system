import type { Prisma } from "@prisma/client";

export interface UserRepository {
  reserveCash(id: string, amount: number, tx: Prisma.TransactionClient): Promise<boolean>;
  consumeReservedCash(id: string, amount: number, tx: Prisma.TransactionClient): Promise<void>;
  releaseReservedCash(id: string, amount: number, tx: Prisma.TransactionClient): Promise<void>;
  creditCash(id: string, amount: number, tx: Prisma.TransactionClient): Promise<void>;
}
