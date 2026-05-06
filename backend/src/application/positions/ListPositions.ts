import type { PositionRecord, PositionRepository } from "./PositionRepository.js";

export class ListPositions {
  constructor(private readonly positions: PositionRepository) {}

  async execute(userId: string): Promise<PositionRecord[]> {
    return this.positions.listByUserId(userId);
  }
}
