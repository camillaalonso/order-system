import type { Prisma } from "@prisma/client";

export type OrderSide = "BUY" | "SELL";
export type OrderStatus = "PENDING" | "EXECUTED" | "FAILED" | "CANCELED";

export type NewOrder = {
  userId: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  price: number;
  totalAmount: number;
  status: OrderStatus;
  executedAt?: Date | null;
};

export type OrderRecord = {
  id: string;
  userId: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  price: number;
  totalAmount: number;
  status: OrderStatus;
  attempts: number;
  failureReason: string | null;
  createdAt: Date;
  executedAt: Date | null;
};

export type ListOrdersFilter = {
  status?: OrderStatus;
};

export interface OrderRepository {
  create(input: NewOrder, tx: Prisma.TransactionClient): Promise<OrderRecord>;
  claimNextPendingOrder(tx: Prisma.TransactionClient): Promise<OrderRecord | null>;
  markExecuted(id: string, executionPrice: number, tx: Prisma.TransactionClient): Promise<void>;
  listByUserId(userId: string, filter?: ListOrdersFilter): Promise<OrderRecord[]>;
  findByIdAndUserId(id: string, userId: string): Promise<OrderRecord | null>;
  lockById(
    id: string,
    userId: string,
    tx: Prisma.TransactionClient,
  ): Promise<OrderRecord | null>;
  markCanceled(id: string, tx: Prisma.TransactionClient): Promise<void>;
  incrementAttempts(id: string): Promise<number>;
  markFailed(id: string, reason: string, tx: Prisma.TransactionClient): Promise<void>;
}
