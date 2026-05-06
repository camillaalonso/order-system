export type Quote = {
  symbol: string;
  price: number;
  fetchedAt: Date;
};

export interface QuotationClient {
  getQuote(symbol: string): Promise<Quote | null>;
}
