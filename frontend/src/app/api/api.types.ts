export type Asset = {
  symbol: string;
  name: string;
  price: number;
  quoteSource: 'live' | 'fallback';
  fetchedAt: string;
};

export type Position = {
  symbol: string;
  name: string;
  quantity: number;
  avgPrice: number;
};

export type OrderSide = 'BUY' | 'SELL';
export type OrderStatus = 'PENDING' | 'EXECUTED' | 'FAILED' | 'CANCELED';

export type Order = {
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
  createdAt: string;
  executedAt: string | null;
};

export type CreateOrderInput = {
  symbol: string;
  side: OrderSide;
  quantity: number;
};

export type ApiError = {
  error: string;
  [key: string]: unknown;
};
