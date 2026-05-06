import { describe, expect, it } from "vitest";
import { CircuitBreakingQuotationClient } from "../../src/infra/quotation/CircuitBreakingQuotationClient.js";
import { RetryingQuotationClient } from "../../src/infra/quotation/RetryingQuotationClient.js";
import type { QuotationClient, Quote } from "../../src/infra/quotation/QuotationClient.js";

class CountingClient implements QuotationClient {
  public calls = 0;
  constructor(private readonly responses: Array<Quote | null>) {}
  async getQuote(symbol: string): Promise<Quote | null> {
    const idx = this.calls;
    this.calls += 1;
    return this.responses[Math.min(idx, this.responses.length - 1)];
  }
}

const quote = (price = 32.0): Quote => ({ symbol: "ITUB4", price, fetchedAt: new Date() });

describe("RetryingQuotationClient", () => {
  it("retorna o primeiro quote sem retry quando inner já tem sucesso", async () => {
    const inner = new CountingClient([quote()]);
    const client = new RetryingQuotationClient(inner, { maxAttempts: 3, baseDelayMs: 1 });
    const result = await client.getQuote("ITUB4");
    expect(result).not.toBeNull();
    expect(inner.calls).toBe(1);
  });

  it("retry até obter sucesso (2 falhas então sucesso)", async () => {
    const inner = new CountingClient([null, null, quote()]);
    const client = new RetryingQuotationClient(inner, { maxAttempts: 3, baseDelayMs: 1 });
    const result = await client.getQuote("ITUB4");
    expect(result).not.toBeNull();
    expect(inner.calls).toBe(3);
  });

  it("retorna null quando esgota tentativas", async () => {
    const inner = new CountingClient([null, null, null]);
    const client = new RetryingQuotationClient(inner, { maxAttempts: 3, baseDelayMs: 1 });
    const result = await client.getQuote("ITUB4");
    expect(result).toBeNull();
    expect(inner.calls).toBe(3);
  });
});

describe("CircuitBreakingQuotationClient", () => {
  it("permanece closed enquanto inner responde", async () => {
    const inner = new CountingClient([quote(), quote(), quote()]);
    const client = new CircuitBreakingQuotationClient(inner, {
      failureThreshold: 2,
      openMs: 10000,
    });
    expect(await client.getQuote("ITUB4")).not.toBeNull();
    expect(await client.getQuote("ITUB4")).not.toBeNull();
    expect(await client.getQuote("ITUB4")).not.toBeNull();
    expect(inner.calls).toBe(3);
  });

  it("abre depois de N falhas consecutivas e bypassa o inner enquanto aberto", async () => {
    const inner = new CountingClient([null, null, null, null, null, quote()]);
    const client = new CircuitBreakingQuotationClient(inner, {
      failureThreshold: 2,
      openMs: 10000,
    });
    expect(await client.getQuote("ITUB4")).toBeNull(); // miss 1, fechado
    expect(await client.getQuote("ITUB4")).toBeNull(); // miss 2 → abre
    expect(inner.calls).toBe(2);

    expect(await client.getQuote("ITUB4")).toBeNull(); // breaker bypassa inner
    expect(await client.getQuote("ITUB4")).toBeNull();
    expect(inner.calls).toBe(2); // inner não foi chamado
  });

  it("half-open após openMs, fecha em sucesso", async () => {
    let nowMs = 0;
    const inner = new CountingClient([null, null, quote()]);
    const client = new CircuitBreakingQuotationClient(inner, {
      failureThreshold: 2,
      openMs: 1000,
      now: () => nowMs,
    });
    expect(await client.getQuote("ITUB4")).toBeNull();
    expect(await client.getQuote("ITUB4")).toBeNull(); // abre
    nowMs += 1500; // passa janela openMs
    expect(await client.getQuote("ITUB4")).not.toBeNull(); // half-open → sucesso → fechado
    expect(inner.calls).toBe(3);
  });

  it("half-open com falha re-abre", async () => {
    let nowMs = 0;
    const inner = new CountingClient([null, null, null, quote()]);
    const client = new CircuitBreakingQuotationClient(inner, {
      failureThreshold: 2,
      openMs: 1000,
      now: () => nowMs,
    });
    expect(await client.getQuote("ITUB4")).toBeNull();
    expect(await client.getQuote("ITUB4")).toBeNull(); // abre
    nowMs += 1500;
    expect(await client.getQuote("ITUB4")).toBeNull(); // half-open → falha → reabre
    expect(inner.calls).toBe(3);
    expect(await client.getQuote("ITUB4")).toBeNull(); // bypass de novo
    expect(inner.calls).toBe(3);
  });
});
