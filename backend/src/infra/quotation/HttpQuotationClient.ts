import { z } from "zod";
import type { Logger } from "pino";
import type { QuotationClient, Quote } from "./QuotationClient.js";

const responseSchema = z.object({
  data: z.object({
    symbol: z.string(),
    price: z.number(),
  }),
});

export type HttpQuotationClientOptions = {
  baseUrl: string;
  timeoutMs?: number;
  logger: Logger;
};

export class HttpQuotationClient implements QuotationClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly logger: Logger;

  constructor(opts: HttpQuotationClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.timeoutMs = opts.timeoutMs ?? 3000;
    this.logger = opts.logger.child({ component: "HttpQuotationClient" });
  }

  async getQuote(symbol: string): Promise<Quote | null> {
    const url = `${this.baseUrl}/quotations/${encodeURIComponent(symbol)}`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);

    try {
      const res = await fetch(url, { signal: ac.signal });

      if (!res.ok) {
        this.logger.warn({ symbol, status: res.status }, "quotation service returned non-2xx");
        return null;
      }

      const json = await res.json();
      const parsed = responseSchema.safeParse(json);
      if (!parsed.success) {
        this.logger.warn({ symbol, issues: parsed.error.issues }, "quotation response failed schema validation");
        return null;
      }

      return {
        symbol: parsed.data.data.symbol,
        price: parsed.data.data.price,
        fetchedAt: new Date(),
      };
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      this.logger.warn(
        { symbol, err: err instanceof Error ? err.message : String(err), aborted },
        aborted ? "quotation request timed out" : "quotation request failed",
      );
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
