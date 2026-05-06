import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import {
  AssetNotFoundError,
  CreateOrder,
  InsufficientAssetError,
  InsufficientCashError,
} from "../../application/orders/CreateOrder.js";
import { GetOrder, OrderNotFoundError } from "../../application/orders/GetOrder.js";
import type { ListOrders } from "../../application/orders/ListOrders.js";
import { CancelOrder, OrderNotCancelableError } from "../../application/orders/CancelOrder.js";

const createOrderBodySchema = z.object({
  symbol: z
    .string()
    .min(1)
    .max(16)
    .transform((s) => s.trim().toUpperCase()),
  side: z.enum(["BUY", "SELL"]),
  quantity: z.number().positive().finite(),
});

const listOrdersQuerySchema = z.object({
  status: z.enum(["PENDING", "EXECUTED", "FAILED", "CANCELED"]).optional(),
});

const orderIdParamsSchema = z.object({
  id: z.string().uuid(),
});

type Deps = {
  createOrder: CreateOrder;
  listOrders: ListOrders;
  getOrder: GetOrder;
  cancelOrder: CancelOrder;
};

export const ordersRoutes: FastifyPluginAsync<Deps> = async (app, opts) => {
  app.post("/orders", { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = createOrderBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: parsed.error.issues,
      });
    }

    try {
      const order = await opts.createOrder.execute({
        userId: request.userId,
        symbol: parsed.data.symbol,
        side: parsed.data.side,
        quantity: parsed.data.quantity,
      });
      return reply.status(201).send({ data: order });
    } catch (err) {
      if (err instanceof AssetNotFoundError) {
        return reply.status(404).send({ error: "asset_not_found", symbol: err.symbol });
      }
      if (err instanceof InsufficientCashError) {
        return reply.status(422).send({ error: "insufficient_cash" });
      }
      if (err instanceof InsufficientAssetError) {
        return reply.status(422).send({ error: "insufficient_asset", symbol: err.symbol });
      }
      throw err;
    }
  });

  app.get("/orders", { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = listOrdersQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: parsed.error.issues,
      });
    }
    const data = await opts.listOrders.execute(request.userId, parsed.data);
    return reply.send({ data });
  });

  app.get("/orders/:id", { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = orderIdParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: parsed.error.issues,
      });
    }
    try {
      const order = await opts.getOrder.execute(parsed.data.id, request.userId);
      return reply.send({ data: order });
    } catch (err) {
      if (err instanceof OrderNotFoundError) {
        return reply.status(404).send({ error: "order_not_found", id: err.id });
      }
      throw err;
    }
  });

  app.delete("/orders/:id", { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = orderIdParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: parsed.error.issues,
      });
    }
    try {
      const order = await opts.cancelOrder.execute(parsed.data.id, request.userId);
      return reply.send({ data: order });
    } catch (err) {
      if (err instanceof OrderNotFoundError) {
        return reply.status(404).send({ error: "order_not_found", id: err.id });
      }
      if (err instanceof OrderNotCancelableError) {
        return reply.status(422).send({
          error: "order_not_cancelable",
          id: err.id,
          status: err.currentStatus,
        });
      }
      throw err;
    }
  });
};
