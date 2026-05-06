import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/infra/db/prisma.js";
import { authHeaders, makeApp, seedDefault } from "./helpers.js";

describe("smoke", () => {
  beforeEach(async () => {
    await seedDefault();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("responds to /health", async () => {
    const app = makeApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok" });
    await app.close();
  });

  it("requires auth header on /positions", async () => {
    const app = makeApp();
    const res = await app.inject({ method: "GET", url: "/positions" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("returns seeded positions for the test user", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "GET",
      url: "/positions",
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(2);
    expect(body.data.map((p: { symbol: string }) => p.symbol).sort()).toEqual([
      "ITUB4",
      "USDC",
    ]);
    await app.close();
  });
});
