export type AssetRecord = {
  symbol: string;
  name: string;
  referencePrice: number;
};

export interface AssetRepository {
  findAll(): Promise<AssetRecord[]>;
  findBySymbol(symbol: string): Promise<AssetRecord | null>;
}
