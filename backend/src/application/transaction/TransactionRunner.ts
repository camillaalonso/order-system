import type { Prisma } from "@prisma/client";

export interface TransactionRunner {
  run<T>(callback: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>;
}
