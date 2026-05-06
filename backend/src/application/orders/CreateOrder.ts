import type { AssetRepository } from "../assets/AssetRepository.js";
import type { PositionRepository } from "../positions/PositionRepository.js";
import type { UserRepository } from "../users/UserRepository.js";
import type { TransactionRunner } from "../transaction/TransactionRunner.js";
import type { QuotationClient } from "../../infra/quotation/QuotationClient.js";
import type { OrderRecord, OrderRepository, OrderSide } from "./OrderRepository.js";

export type CreateOrderInput = {
  userId: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
};

export class AssetNotFoundError extends Error {
  constructor(public readonly symbol: string) {
    super(`Asset ${symbol} not found`);
    this.name = "AssetNotFoundError";
  }
}

export class InsufficientCashError extends Error {
  constructor() {
    super("Insufficient cash balance");
    this.name = "InsufficientCashError";
  }
}

export class InsufficientAssetError extends Error {
  constructor(public readonly symbol: string) {
    super(`Insufficient ${symbol} balance`);
    this.name = "InsufficientAssetError";
  }
}

export class CreateOrder {
  constructor(
    private readonly assets: AssetRepository,
    private readonly users: UserRepository,
    private readonly positions: PositionRepository,
    private readonly orders: OrderRepository,
    private readonly quotationClient: QuotationClient,
    private readonly transactionRunner: TransactionRunner,
  ) {}

  async execute(input: CreateOrderInput): Promise<OrderRecord> {
    const asset = await this.assets.findBySymbol(input.symbol);
    if (!asset) throw new AssetNotFoundError(input.symbol);

    const quote = await this.quotationClient.getQuote(input.symbol);
    const price = quote?.price ?? asset.referencePrice;
    const totalAmount = round2(input.quantity * price);

    return this.transactionRunner.run(async (tx) => {
      if (input.side === "BUY") {
        const reserved = await this.users.reserveCash(input.userId, totalAmount, tx);
        if (!reserved) throw new InsufficientCashError();
      } else {
        const reserved = await this.positions.reserveQuantity(
          input.userId,
          input.symbol,
          input.quantity,
          tx,
        );
        if (!reserved) throw new InsufficientAssetError(input.symbol);
      }

      return this.orders.create(
        {
          userId: input.userId,
          symbol: input.symbol,
          side: input.side,
          quantity: input.quantity,
          price,
          totalAmount,
          status: "PENDING",
          executedAt: null,
        },
        tx,
      );
    });
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
