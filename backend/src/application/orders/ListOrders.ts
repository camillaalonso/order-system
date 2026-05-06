import type {
  ListOrdersFilter,
  OrderRecord,
  OrderRepository,
} from "./OrderRepository.js";

export class ListOrders {
  constructor(private readonly orders: OrderRepository) {}

  execute(userId: string, filter?: ListOrdersFilter): Promise<OrderRecord[]> {
    return this.orders.listByUserId(userId, filter);
  }
}
