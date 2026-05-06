import type { OrderRecord, OrderRepository } from "./OrderRepository.js";

export class OrderNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Order ${id} not found`);
    this.name = "OrderNotFoundError";
  }
}

export class GetOrder {
  constructor(private readonly orders: OrderRepository) {}

  async execute(id: string, userId: string): Promise<OrderRecord> {
    const order = await this.orders.findByIdAndUserId(id, userId);
    if (!order) throw new OrderNotFoundError(id);
    return order;
  }
}
