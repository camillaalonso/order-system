import type { PrismaClient } from "@prisma/client";
import type { AssetRecord, AssetRepository } from "../../application/assets/AssetRepository.js";

export class PrismaAssetRepository implements AssetRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findAll(): Promise<AssetRecord[]> {
    const rows = await this.prisma.asset.findMany({ orderBy: { symbol: "asc" } });
    return rows.map((row) => ({
      symbol: row.symbol,
      name: row.name,
      referencePrice: row.referencePrice.toNumber(),
    }));
  }

  async findBySymbol(symbol: string): Promise<AssetRecord | null> {
    const row = await this.prisma.asset.findUnique({ where: { symbol } });
    if (!row) return null;
    return {
      symbol: row.symbol,
      name: row.name,
      referencePrice: row.referencePrice.toNumber(),
    };
  }
}
