import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/infra/db/prisma.js";
import {
  StubQuotationClient,
  authHeaders,
  makeApp,
  seedDefault,
  TEST_USER,
} from "./helpers.js";

describe("POST /orders", () => {
  beforeEach(async () => {
    await seedDefault();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates a BUY as PENDING and reserves cash", async () => {
    const app = makeApp(new StubQuotationClient({ ITUB4: 32.5 }));
    const res = await app.inject({
      method: "POST",
      url: "/orders",
      headers: authHeaders(),
      payload: { symbol: "ITUB4", side: "BUY", quantity: 2 },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.data).toMatchObject({
      symbol: "ITUB4",
      side: "BUY",
      quantity: 2,
      price: 32.5,
      totalAmount: 65,
      status: "PENDING",
      executedAt: null,
    });

    const user = await prisma.user.findUnique({ where: { id: TEST_USER } });
    expect(user?.cashBalance.toString()).toBe("9935");
    expect(user?.reservedCash.toString()).toBe("65");
    await app.close();
  });

  it("creates a SELL as PENDING and reserves quantity", async () => {
    const app = makeApp(new StubQuotationClient({ ITUB4: 33 }));
    const res = await app.inject({
      method: "POST",
      url: "/orders",
      headers: authHeaders(),
      payload: { symbol: "ITUB4", side: "SELL", quantity: 10 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.status).toBe("PENDING");

    const pos = await prisma.position.findUnique({
      where: { userId_symbol: { userId: TEST_USER, symbol: "ITUB4" } },
    });
    expect(pos?.quantity.toString()).toBe("90");
    expect(pos?.reservedQuantity.toString()).toBe("10");
    await app.close();
  });

  it("falls back to referencePrice when quotation returns null", async () => {
    const app = makeApp(new StubQuotationClient()); // empty map → all null
    const res = await app.inject({
      method: "POST",
      url: "/orders",
      headers: authHeaders(),
      payload: { symbol: "ITUB4", side: "BUY", quantity: 1 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.price).toBe(32.8); // referencePrice from seed
    await app.close();
  });

  it("returns 422 insufficient_cash when cash < total", async () => {
    const app = makeApp(new StubQuotationClient({ ITUB4: 32.5 }));
    const res = await app.inject({
      method: "POST",
      url: "/orders",
      headers: authHeaders(),
      payload: { symbol: "ITUB4", side: "BUY", quantity: 1000 },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe("insufficient_cash");

    const user = await prisma.user.findUnique({ where: { id: TEST_USER } });
    expect(user?.cashBalance.toString()).toBe("10000");
    expect(user?.reservedCash.toString()).toBe("0");
    const orderCount = await prisma.order.count();
    expect(orderCount).toBe(0);
    await app.close();
  });

  it("returns 422 insufficient_asset when SELL > position", async () => {
    const app = makeApp(new StubQuotationClient({ ITUB4: 33 }));
    const res = await app.inject({
      method: "POST",
      url: "/orders",
      headers: authHeaders(),
      payload: { symbol: "ITUB4", side: "SELL", quantity: 200 },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe("insufficient_asset");
    const orderCount = await prisma.order.count();
    expect(orderCount).toBe(0);
    await app.close();
  });

  it("returns 404 when asset not found", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/orders",
      headers: authHeaders(),
      payload: { symbol: "XYZ123", side: "BUY", quantity: 1 },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("asset_not_found");
    await app.close();
  });

  it("returns 401 without auth header", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/orders",
      payload: { symbol: "ITUB4", side: "BUY", quantity: 1 },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("returns 400 on invalid body", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/orders",
      headers: authHeaders(),
      payload: { symbol: "ITUB4", side: "BUY" }, // missing quantity
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_request");
    await app.close();
  });

  it("returns 400 on negative quantity", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/orders",
      headers: authHeaders(),
      payload: { symbol: "ITUB4", side: "BUY", quantity: -1 },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
