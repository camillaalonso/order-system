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

async function createBuy(price: number, quantity: number, user = TEST_USER) {
  const app = makeApp(new StubQuotationClient({ ITUB4: price }));
  const res = await app.inject({
    method: "POST",
    url: "/orders",
    headers: authHeaders(user),
    payload: { symbol: "ITUB4", side: "BUY", quantity },
  });
  await app.close();
  return res.json().data.id;
}

describe("GET /orders e GET /orders/:id", () => {
  beforeEach(async () => {
    await seedDefault();
    // Cria um segundo usuário pra confirmar isolamento
    await prisma.user.create({
      data: { id: OTHER_USER, name: "Other", cashBalance: "10000.00" },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("GET /orders vazio quando user não tem ordens", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "GET",
      url: "/orders",
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
    await app.close();
  });

  it("GET /orders lista só as ordens do user autenticado", async () => {
    await createBuy(32, 1, TEST_USER);
    await createBuy(32, 2, TEST_USER);
    await createBuy(32, 3, OTHER_USER);

    const app = makeApp();
    const res = await app.inject({
      method: "GET",
      url: "/orders",
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data).toHaveLength(2);
    expect(data.every((o: { userId: string }) => o.userId === TEST_USER)).toBe(true);
    await app.close();
  });

  it("GET /orders ordena por createdAt DESC (mais recente primeiro)", async () => {
    await createBuy(32, 1);
    await new Promise((r) => setTimeout(r, 10));
    await createBuy(32, 2);

    const app = makeApp();
    const res = await app.inject({
      method: "GET",
      url: "/orders",
      headers: authHeaders(),
    });
    const data = res.json().data;
    expect(data[0].quantity).toBe(2);
    expect(data[1].quantity).toBe(1);
    await app.close();
  });

  it("GET /orders?status=PENDING filtra", async () => {
    const id = await createBuy(32, 1);
    await prisma.order.update({ where: { id }, data: { status: "EXECUTED" } });
    await createBuy(32, 1); // continua PENDING

    const app = makeApp();
    const r1 = await app.inject({
      method: "GET",
      url: "/orders?status=PENDING",
      headers: authHeaders(),
    });
    expect(r1.json().data).toHaveLength(1);

    const r2 = await app.inject({
      method: "GET",
      url: "/orders?status=EXECUTED",
      headers: authHeaders(),
    });
    expect(r2.json().data).toHaveLength(1);
    await app.close();
  });

  it("GET /orders/:id retorna a ordem do user", async () => {
    const id = await createBuy(32, 1);
    const app = makeApp();
    const res = await app.inject({
      method: "GET",
      url: `/orders/${id}`,
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(id);
    await app.close();
  });

  it("GET /orders/:id retorna 404 quando é de outro user", async () => {
    const id = await createBuy(32, 1, TEST_USER);
    const app = makeApp();
    const res = await app.inject({
      method: "GET",
      url: `/orders/${id}`,
      headers: authHeaders(OTHER_USER),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("order_not_found");
    await app.close();
  });

  it("GET /orders/:id retorna 404 quando uuid não existe", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "GET",
      url: "/orders/00000000-0000-0000-0000-000000000000",
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("GET /orders/:id retorna 400 com uuid inválido", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "GET",
      url: "/orders/not-a-uuid",
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
