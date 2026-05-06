import type { Prisma } from "@prisma/client";

export type PositionRecord = {
  symbol: string;
  name: string;
  quantity: number;
  avgPrice: number;
};

export type PositionState = {
  userId: string;
  symbol: string;
  quantity: number;
  reservedQuantity: number;
  avgPrice: number;
};

export interface PositionRepository {
  listByUserId(userId: string): Promise<PositionRecord[]>;
  findByUserAndSymbol(
    userId: string,
    symbol: string,
    tx?: Prisma.TransactionClient,
  ): Promise<PositionState | null>;
  upsert(
    userId: string,
    symbol: string,
    quantity: number,
    avgPrice: number,
    tx: Prisma.TransactionClient,
  ): Promise<void>;
  reserveQuantity(
    userId: string,
    symbol: string,
    amount: number,
    tx: Prisma.TransactionClient,
  ): Promise<boolean>;
  consumeReservedQuantity(
    userId: string,
    symbol: string,
    amount: number,
    tx: Prisma.TransactionClient,
  ): Promise<void>;
  releaseReservedQuantity(
    userId: string,
    symbol: string,
    amount: number,
    tx: Prisma.TransactionClient,
  ): Promise<void>;
}
