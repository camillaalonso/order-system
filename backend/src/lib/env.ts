import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  DATABASE_URL: z.string().url(),
  QUOTATION_SERVICE_URL: z.string().url(),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(500),
  QUOTATION_TIMEOUT_MS: z.coerce.number().int().positive().default(1500),
  QUOTATION_RETRY_ATTEMPTS: z.coerce.number().int().positive().default(3),
  QUOTATION_RETRY_BASE_MS: z.coerce.number().int().positive().default(100),
  QUOTATION_BREAKER_THRESHOLD: z.coerce.number().int().positive().default(5),
  QUOTATION_BREAKER_OPEN_MS: z.coerce.number().int().positive().default(10000),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", z.treeifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
