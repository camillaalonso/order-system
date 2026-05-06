import type { Logger } from "pino";
import type { QuotationClient, Quote } from "./QuotationClient.js";

export type CircuitBreakingOptions = {
  failureThreshold?: number;
  openMs?: number;
  logger?: Logger;
  now?: () => number;
};

type State = "closed" | "open" | "half-open";

export class CircuitBreakingQuotationClient implements QuotationClient {
  private readonly failureThreshold: number;
  private readonly openMs: number;
  private readonly logger?: Logger;
  private readonly now: () => number;

  private state: State = "closed";
  private consecutiveFailures = 0;
  private openedAt = 0;

  constructor(
    private readonly inner: QuotationClient,
    opts: CircuitBreakingOptions = {},
  ) {
    this.failureThreshold = opts.failureThreshold ?? 5;
    this.openMs = opts.openMs ?? 10000;
    this.logger = opts.logger?.child({ component: "CircuitBreakingQuotationClient" });
    this.now = opts.now ?? (() => Date.now());
  }

  async getQuote(symbol: string): Promise<Quote | null> {
    if (this.state === "open") {
      if (this.now() - this.openedAt < this.openMs) {
        return null;
      }
      this.state = "half-open";
      this.logger?.info({ symbol }, "circuit half-open: trying probe");
    }

    const quote = await this.inner.getQuote(symbol);

    if (quote) {
      if (this.state !== "closed") {
        this.logger?.info({ symbol, prevState: this.state }, "circuit closed");
      }
      this.state = "closed";
      this.consecutiveFailures = 0;
      return quote;
    }

    this.consecutiveFailures += 1;
    if (this.state === "half-open" || this.consecutiveFailures >= this.failureThreshold) {
      this.state = "open";
      this.openedAt = this.now();
      this.logger?.warn(
        { symbol, consecutiveFailures: this.consecutiveFailures, openMs: this.openMs },
        "circuit opened",
      );
    }
    return null;
  }
}
