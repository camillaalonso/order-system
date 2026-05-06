import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/infra/db/prisma.js";
import {
  StubQuotationClient,
  authHeaders,
  makeApp,
  seedDefault,
  TEST_USER,
  OTHER_USER,
} from "./helpers.js";

async function createBuy(price: number, quantity: number): Promise<string> {
  const app = makeApp(new StubQuotationClient({ ITUB4: price }));
  const res = await app.inject({
    method: "POST",
    url: "/orders",
    headers: authHeaders(),
    payload: { symbol: "ITUB4", side: "BUY", quantity },
  });
  await app.close();
  return res.json().data.id;
}

describe("DELETE /orders/:id", () => {
  beforeEach(async () => {
    await seedDefault();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("cancela PENDING e devolve a reserva (BUY)", async () => {
    const id = await createBuy(32.0, 1);

    const app = makeApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/orders/${id}`,
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("CANCELED");

    const user = await prisma.user.findUnique({ where: { id: TEST_USER } });
    expect(user?.cashBalance.toString()).toBe("10000");
    expect(user?.reservedCash.toString()).toBe("0");
    await app.close();
  });

  it("cancela PENDING e devolve a reserva (SELL — reservedQuantity → quantity)", async () => {
    const app1 = makeApp(new StubQuotationClient({ ITUB4: 33 }));
    const create = await app1.inject({
      method: "POST",
      url: "/orders",
      headers: authHeaders(),
      payload: { symbol: "ITUB4", side: "SELL", quantity: 30 },
    });
    const id = create.json().data.id;
    await app1.close();

    const app = makeApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/orders/${id}`,
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(200);

    const pos = await prisma.position.findUnique({
      where: { userId_symbol: { userId: TEST_USER, symbol: "ITUB4" } },
    });
    expect(pos?.quantity.toString()).toBe("100");
    expect(pos?.reservedQuantity.toString()).toBe("0");
    await app.close();
  });

  it("422 ao cancelar ordem já CANCELED", async () => {
    const id = await createBuy(32.0, 1);
    const app = makeApp();
    await app.inject({ method: "DELETE", url: `/orders/${id}`, headers: authHeaders() });
    const res = await app.inject({
      method: "DELETE",
      url: `/orders/${id}`,
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({
      error: "order_not_cancelable",
      status: "CANCELED",
    });
    await app.close();
  });

  it("404 ao cancelar uuid inexistente", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "DELETE",
      url: "/orders/00000000-0000-0000-0000-000000000000",
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("order_not_found");
    await app.close();
  });

  it("404 ao cancelar ordem de outro usuário (não vaza existência)", async () => {
    const id = await createBuy(32.0, 1);
    const app = makeApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/orders/${id}`,
      headers: authHeaders(OTHER_USER),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("order_not_found");

    // Ordem original continua PENDING (intocada)
    const order = await prisma.order.findUnique({ where: { id } });
    expect(order?.status).toBe("PENDING");
    await app.close();
  });

  it("400 ao cancelar com uuid inválido", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "DELETE",
      url: "/orders/abc",
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
