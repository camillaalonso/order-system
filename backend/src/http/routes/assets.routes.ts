import type { FastifyPluginAsync } from "fastify";
import type { ListAssetsWithQuote } from "../../application/assets/ListAssetsWithQuote.js";

type Deps = {
  listAssets: ListAssetsWithQuote;
};

export const assetsRoutes: FastifyPluginAsync<Deps> = async (app, opts) => {
  app.get("/assets", async () => {
    const data = await opts.listAssets.execute();
    return { data };
  });
};
