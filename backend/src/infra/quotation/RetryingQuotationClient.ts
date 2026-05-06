import type { Logger } from "pino";
import type { QuotationClient, Quote } from "./QuotationClient.js";

export type RetryingOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  logger?: Logger;
};

export class RetryingQuotationClient implements QuotationClient {
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly logger?: Logger;

  constructor(
    private readonly inner: QuotationClient,
    opts: RetryingOptions = {},
  ) {
    this.maxAttempts = opts.maxAttempts ?? 3;
    this.baseDelayMs = opts.baseDelayMs ?? 100;
    this.logger = opts.logger?.child({ component: "RetryingQuotationClient" });
  }

  async getQuote(symbol: string): Promise<Quote | null> {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const quote = await this.inner.getQuote(symbol);
      if (quote) return quote;

      if (attempt < this.maxAttempts) {
        const delayMs = this.baseDelayMs * 2 ** (attempt - 1);
        this.logger?.debug({ symbol, attempt, nextDelayMs: delayMs }, "quote retry");
        await sleep(delayMs);
      }
    }
    this.logger?.warn({ symbol, attempts: this.maxAttempts }, "quote failed after all retries");
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
