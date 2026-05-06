import type { Prisma } from "@prisma/client";
import type { QuotationClient } from "../../infra/quotation/QuotationClient.js";
import type { PositionRepository } from "../positions/PositionRepository.js";
import type { UserRepository } from "../users/UserRepository.js";
import type { OrderRecord, OrderRepository, OrderSide } from "./OrderRepository.js";

export const SLIPPAGE_TOLERANCE = 0.05;

export class OrderRejectedError extends Error {
  constructor(
    public readonly orderId: string,
    public readonly reason: string,
  ) {
    super(`Order ${orderId} rejected: ${reason}`);
    this.name = "OrderRejectedError";
  }
}

export class ExecuteOrder {
  constructor(
    private readonly users: UserRepository,
    private readonly positions: PositionRepository,
    private readonly orders: OrderRepository,
    private readonly quotationClient: QuotationClient,
  ) {}

  async execute(order: OrderRecord, tx: Prisma.TransactionClient): Promise<void> {
    const executionPrice = await this.resolveExecutionPrice(order);

    if (order.side === "BUY") {
      const actualCost = round2(order.quantity * executionPrice);
      // Reserva foi `order.totalAmount` (= quantity * order.price gravado).
      // Consome o que vai gastar; devolve o excedente (caso preço caiu).
      await this.users.consumeReservedCash(order.userId, actualCost, tx);
      const refund = round2(order.totalAmount - actualCost);
      if (refund > 0) {
        await this.users.releaseReservedCash(order.userId, refund, tx);
      }

      const existing = await this.positions.findByUserAndSymbol(order.userId, order.symbol, tx);
      const newQuantity = (existing?.quantity ?? 0) + order.quantity;
      const newAvgPrice = existing
        ? (existing.quantity * existing.avgPrice + order.quantity * executionPrice) / newQuantity
        : executionPrice;
      await this.positions.upsert(order.userId, order.symbol, newQuantity, round4(newAvgPrice), tx);
    } else {
      await this.positions.consumeReservedQuantity(order.userId, order.symbol, order.quantity, tx);
      const credit = round2(order.quantity * executionPrice);
      await this.users.creditCash(order.userId, credit, tx);
    }

    await this.orders.markExecuted(order.id, executionPrice, tx);
  }

  private async resolveExecutionPrice(order: OrderRecord): Promise<number> {
    const quote = await this.quotationClient.getQuote(order.symbol);
    if (!quote) {
      // Quotation falhou (ou breaker aberto) — usa preço gravado na criação.
      return order.price;
    }

    const newPrice = quote.price;
    if (isUnacceptableSlippage(order.side, order.price, newPrice)) {
      throw new OrderRejectedError(
        order.id,
        `slippage > ${(SLIPPAGE_TOLERANCE * 100).toFixed(0)}%: ` +
          `quoted=${newPrice} agreed=${order.price} side=${order.side}`,
      );
    }

    // Limit-order semantics: BUY nunca paga mais que o agreed; SELL sempre executa
    // ao preço de mercado (com tolerance check protegendo o piso).
    if (order.side === "BUY") {
      return Math.min(newPrice, order.price);
    }
    return newPrice;
  }
}

function isUnacceptableSlippage(side: OrderSide, agreed: number, quoted: number): boolean {
  if (side === "BUY") {
    return quoted > agreed * (1 + SLIPPAGE_TOLERANCE);
  }
  return quoted < agreed * (1 - SLIPPAGE_TOLERANCE);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
