import type { Logger } from "pino";
import { env } from "../../lib/env.js";
import { CircuitBreakingQuotationClient } from "./CircuitBreakingQuotationClient.js";
import { HttpQuotationClient } from "./HttpQuotationClient.js";
import type { QuotationClient } from "./QuotationClient.js";
import { RetryingQuotationClient } from "./RetryingQuotationClient.js";

export function buildQuotationClient(logger: Logger): QuotationClient {
  const http = new HttpQuotationClient({
    baseUrl: env.QUOTATION_SERVICE_URL,
    timeoutMs: env.QUOTATION_TIMEOUT_MS,
    logger,
  });
  const retrying = new RetryingQuotationClient(http, {
    maxAttempts: env.QUOTATION_RETRY_ATTEMPTS,
    baseDelayMs: env.QUOTATION_RETRY_BASE_MS,
    logger,
  });
  return new CircuitBreakingQuotationClient(retrying, {
    failureThreshold: env.QUOTATION_BREAKER_THRESHOLD,
    openMs: env.QUOTATION_BREAKER_OPEN_MS,
    logger,
  });
}
