import Fastify from "fastify";
import cors from "@fastify/cors";
import { logger } from "../lib/logger.js";
import { prisma } from "../infra/db/prisma.js";
import { PrismaAssetRepository } from "../infra/db/PrismaAssetRepository.js";
import { PrismaPositionRepository } from "../infra/db/PrismaPositionRepository.js";
import { PrismaUserRepository } from "../infra/db/PrismaUserRepository.js";
import { PrismaOrderRepository } from "../infra/db/PrismaOrderRepository.js";
import { PrismaTransactionRunner } from "../infra/db/PrismaTransactionRunner.js";
import { buildQuotationClient } from "../infra/quotation/buildQuotationClient.js";
import type { QuotationClient } from "../infra/quotation/QuotationClient.js";
import { ListAssetsWithQuote } from "../application/assets/ListAssetsWithQuote.js";
import { ListPositions } from "../application/positions/ListPositions.js";
import { CreateOrder } from "../application/orders/CreateOrder.js";
import { ListOrders } from "../application/orders/ListOrders.js";
import { GetOrder } from "../application/orders/GetOrder.js";
import { CancelOrder } from "../application/orders/CancelOrder.js";
import { assetsRoutes } from "./routes/assets.routes.js";
import { positionsRoutes } from "./routes/positions.routes.js";
import { ordersRoutes } from "./routes/orders.routes.js";

export type BuildServerOptions = {
  quotationClient?: QuotationClient;
};

export function buildServer(opts: BuildServerOptions = {}) {
  const app = Fastify({ loggerInstance: logger });

  app.register(cors, {
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["content-type", "x-user-id"],
  });

  const assetRepository = new PrismaAssetRepository(prisma);
  const positionRepository = new PrismaPositionRepository(prisma);
  const userRepository = new PrismaUserRepository();
  const orderRepository = new PrismaOrderRepository(prisma);
  const transactionRunner = new PrismaTransactionRunner(prisma);

  const quotationClient = opts.quotationClient ?? buildQuotationClient(logger);

  const listAssets = new ListAssetsWithQuote(assetRepository, quotationClient);
  const listPositions = new ListPositions(positionRepository);
  const createOrder = new CreateOrder(
    assetRepository,
    userRepository,
    positionRepository,
    orderRepository,
    quotationClient,
    transactionRunner,
  );
  const listOrders = new ListOrders(orderRepository);
  const getOrder = new GetOrder(orderRepository);
  const cancelOrder = new CancelOrder(
    userRepository,
    positionRepository,
    orderRepository,
    transactionRunner,
  );

  app.get("/health", async () => ({ status: "ok", timestamp: new Date().toISOString() }));
  app.register(assetsRoutes, { listAssets });
  app.register(positionsRoutes, { listPositions });
  app.register(ordersRoutes, { createOrder, listOrders, getOrder, cancelOrder });

  return app;
}
