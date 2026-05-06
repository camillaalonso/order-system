import type { Prisma, PrismaClient } from "@prisma/client";
import type { TransactionRunner } from "../../application/transaction/TransactionRunner.js";

export class PrismaTransactionRunner implements TransactionRunner {
  constructor(private readonly prisma: PrismaClient) {}

  run<T>(callback: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(callback);
  }
}
