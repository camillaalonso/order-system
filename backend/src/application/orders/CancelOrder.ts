import type { PositionRepository } from "../positions/PositionRepository.js";
import type { TransactionRunner } from "../transaction/TransactionRunner.js";
import type { UserRepository } from "../users/UserRepository.js";
import { OrderNotFoundError } from "./GetOrder.js";
import type {
  OrderRecord,
  OrderRepository,
  OrderStatus,
} from "./OrderRepository.js";

export class OrderNotCancelableError extends Error {
  constructor(
    public readonly id: string,
    public readonly currentStatus: OrderStatus,
  ) {
    super(`Order ${id} is ${currentStatus}; only PENDING orders can be canceled`);
    this.name = "OrderNotCancelableError";
  }
}

export class CancelOrder {
  constructor(
    private readonly users: UserRepository,
    private readonly positions: PositionRepository,
    private readonly orders: OrderRepository,
    private readonly transactionRunner: TransactionRunner,
  ) {}

  execute(id: string, userId: string): Promise<OrderRecord> {
    return this.transactionRunner.run(async (tx) => {
      const order = await this.orders.lockById(id, userId, tx);
      if (!order) throw new OrderNotFoundError(id);
      if (order.status !== "PENDING") {
        throw new OrderNotCancelableError(id, order.status);
      }

      if (order.side === "BUY") {
        await this.users.releaseReservedCash(order.userId, order.totalAmount, tx);
      } else {
        await this.positions.releaseReservedQuantity(
          order.userId,
          order.symbol,
          order.quantity,
          tx,
        );
      }

      await this.orders.markCanceled(id, tx);
      return { ...order, status: "CANCELED" };
    });
  }
}
