import type { Logger } from "pino";
import type { ExecuteOrder } from "../application/orders/ExecuteOrder.js";
import { OrderRejectedError } from "../application/orders/ExecuteOrder.js";
import type { OrderRecord, OrderRepository } from "../application/orders/OrderRepository.js";
import type { PositionRepository } from "../application/positions/PositionRepository.js";
import type { TransactionRunner } from "../application/transaction/TransactionRunner.js";
import type { UserRepository } from "../application/users/UserRepository.js";

export const MAX_EXECUTION_ATTEMPTS = 3;

export type RunWorkerTickDeps = {
  orders: OrderRepository;
  users: UserRepository;
  positions: PositionRepository;
  runner: TransactionRunner;
  executeOrder: ExecuteOrder;
  logger: Logger;
};

/**
 * Processa no máximo uma ordem por chamada.
 * Retorna `true` se uma ordem foi processada (sucesso OU falha tratada),
 * `false` se a fila estava vazia.
 */
export async function runWorkerTick(deps: RunWorkerTickDeps): Promise<boolean> {
  const { orders, users, positions, runner, executeOrder, logger } = deps;

  let claimedOrder: OrderRecord | null = null;
  let executionError: unknown = null;

  try {
    await runner.run(async (tx) => {
      const order = await orders.claimNextPendingOrder(tx);
      if (!order) return;
      claimedOrder = order;
      logger.info(
        { orderId: order.id, userId: order.userId, symbol: order.symbol, side: order.side },
        "executing order",
      );
      await executeOrder.execute(order, tx);
    });
  } catch (err) {
    executionError = err;
  }

  if (!claimedOrder) {
    return false;
  }

  if (!executionError) {
    return true;
  }

  // Order was claimed but execution failed. Persist attempts in a separate tx
  // (the main tx rolled back, so the in-tx increment was reverted).
  // Cast since TS narrows claimedOrder to never inside this branch.
  const order: OrderRecord = claimedOrder;
  const newAttempts = await orders.incrementAttempts(order.id);
  const isRejection = executionError instanceof OrderRejectedError;
  const reason = isRejection
    ? (executionError as OrderRejectedError).reason
    : executionError instanceof Error
      ? executionError.message
      : String(executionError);

  if (isRejection || newAttempts >= MAX_EXECUTION_ATTEMPTS) {
    await failOrder({ orders, users, positions, runner, order, reason, logger });
    logger.warn(
      { orderId: order.id, attempts: newAttempts, reason, isRejection },
      "order failed permanently",
    );
  } else {
    logger.warn(
      { orderId: order.id, attempts: newAttempts, reason },
      "order will retry on next tick",
    );
  }

  return true;
}

async function failOrder(args: {
  orders: OrderRepository;
  users: UserRepository;
  positions: PositionRepository;
  runner: TransactionRunner;
  order: OrderRecord;
  reason: string;
  logger: Logger;
}): Promise<void> {
  const { orders, users, positions, runner, order, reason, logger } = args;
  await runner.run(async (tx) => {
    const locked = await orders.lockById(order.id, order.userId, tx);
    if (!locked || locked.status !== "PENDING") {
      logger.warn(
        { orderId: order.id, currentStatus: locked?.status ?? "missing" },
        "skipping fail: order no longer PENDING",
      );
      return;
    }
    if (order.side === "BUY") {
      await users.releaseReservedCash(order.userId, order.totalAmount, tx);
    } else {
      await positions.releaseReservedQuantity(order.userId, order.symbol, order.quantity, tx);
    }
    await orders.markFailed(order.id, reason, tx);
  });
}
