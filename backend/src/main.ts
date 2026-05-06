import { env } from "./lib/env.js";
import { logger } from "./lib/logger.js";
import { buildServer } from "./http/server.js";

async function start() {
  const app = buildServer();

  try {
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
    logger.info({ port: env.PORT }, "Backend ready");
  } catch (err) {
    logger.error(err, "Failed to start server");
    process.exit(1);
  }
}

start();
