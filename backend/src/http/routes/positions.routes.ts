import type { FastifyPluginAsync } from "fastify";
import type { ListPositions } from "../../application/positions/ListPositions.js";
import { requireAuth } from "../middleware/auth.js";

type Deps = {
  listPositions: ListPositions;
};

export const positionsRoutes: FastifyPluginAsync<Deps> = async (app, opts) => {
  app.get("/positions", { preHandler: [requireAuth] }, async (request) => {
    const data = await opts.listPositions.execute(request.userId);
    return { data };
  });
};
