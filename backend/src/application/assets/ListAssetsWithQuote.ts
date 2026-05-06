import type { AssetRepository } from "./AssetRepository.js";
import type { QuotationClient } from "../../infra/quotation/QuotationClient.js";

export type AssetWithQuote = {
  symbol: string;
  name: string;
  price: number;
  quoteSource: "live" | "fallback";
  fetchedAt: string;
};

export class ListAssetsWithQuote {
  constructor(
    private readonly assets: AssetRepository,
    private readonly quotationClient: QuotationClient,
  ) {}

  async execute(): Promise<AssetWithQuote[]> {
    const assets = await this.assets.findAll();
    const fallbackTimestamp = new Date().toISOString();

    return Promise.all(
      assets.map(async (asset) => {
        const quote = await this.quotationClient.getQuote(asset.symbol);
        if (quote) {
          return {
            symbol: asset.symbol,
            name: asset.name,
            price: quote.price,
            quoteSource: "live" as const,
            fetchedAt: quote.fetchedAt.toISOString(),
          };
        }
        return {
          symbol: asset.symbol,
          name: asset.name,
          price: asset.referencePrice,
          quoteSource: "fallback" as const,
          fetchedAt: fallbackTimestamp,
        };
      }),
    );
  }
}
