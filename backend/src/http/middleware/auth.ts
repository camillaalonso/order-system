import type { FastifyReply, FastifyRequest } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    userId: string;
  }
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers["x-user-id"];
  const userId = Array.isArray(header) ? header[0] : header;

  if (!userId || userId.trim() === "") {
    return reply.code(401).send({ error: "unauthorized", message: "missing x-user-id header" });
  }

  request.userId = userId.trim();
}
