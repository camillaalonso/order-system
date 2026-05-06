import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/infra/db/prisma.js";
import {
  StubQuotationClient,
  authHeaders,
  makeApp,
  processOne,
  seedDefault,
  TEST_USER,
} from "./helpers.js";
import type { QuotationClient } from "../../src/infra/quotation/QuotationClient.js";

describe("worker — claim + execute", () => {
  beforeEach(async () => {
    await seedDefault();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("processa BUY: PENDING → EXECUTED, consome reserva, atualiza posição com avgPrice ponderado", async () => {
    const app = makeApp(new StubQuotationClient({ ITUB4: 33.0 }));
    const create = await app.inject({
      method: "POST",
      url: "/orders",
      headers: authHeaders(),
      payload: { symbol: "ITUB4", side: "BUY", quantity: 10 },
    });
    const orderId = create.json().data.id;
    await app.close();

    const processed = await processOne(new StubQuotationClient());
    expect(processed).toBe(true);

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    expect(order?.status).toBe("EXECUTED");
    expect(order?.executedAt).not.toBeNull();

    const user = await prisma.user.findUnique({ where: { id: TEST_USER } });
    expect(user?.cashBalance.toString()).toBe("9670");
    expect(user?.reservedCash.toString()).toBe("0");

    const pos = await prisma.position.findUnique({
      where: { userId_symbol: { userId: TEST_USER, symbol: "ITUB4" } },
    });
    expect(pos?.quantity.toString()).toBe("110");
    expect(pos?.reservedQuantity.toString()).toBe("0");
    // avgPrice = (100*30 + 10*33) / 110 = 30.27272727... → arredondado a 4 casas
    expect(pos?.avgPrice.toString()).toBe("30.2727");
  });

  it("processa SELL: PENDING → EXECUTED, libera reserva e credita cash", async () => {
    const app = makeApp(new StubQuotationClient({ ITUB4: 35.0 }));
    await app.inject({
      method: "POST",
      url: "/orders",
      headers: authHeaders(),
      payload: { symbol: "ITUB4", side: "SELL", quantity: 30 },
    });
    await app.close();

    await processOne();

    const user = await prisma.user.findUnique({ where: { id: TEST_USER } });
    expect(user?.cashBalance.toString()).toBe("11050"); // 10000 + 30*35

    const pos = await prisma.position.findUnique({
      where: { userId_symbol: { userId: TEST_USER, symbol: "ITUB4" } },
    });
    expect(pos?.quantity.toString()).toBe("70");
    expect(pos?.reservedQuantity.toString()).toBe("0");
  });

  it("retorna false quando não há ordens PENDING", async () => {
    const processed = await processOne(new StubQuotationClient());
    expect(processed).toBe(false);
  });

  it("FOR UPDATE SKIP LOCKED: 2 workers concorrentes pegam ordens diferentes", async () => {
    const app = makeApp(new StubQuotationClient({ ITUB4: 32 }));
    for (let i = 0; i < 2; i++) {
      await app.inject({
        method: "POST",
        url: "/orders",
        headers: authHeaders(),
        payload: { symbol: "ITUB4", side: "BUY", quantity: 1 },
      });
    }
    await app.close();

    const [r1, r2] = await Promise.all([processOne(), processOne()]);
    expect(r1).toBe(true);
    expect(r2).toBe(true);

    const remaining = await prisma.order.count({ where: { status: "PENDING" } });
    expect(remaining).toBe(0);
    const executed = await prisma.order.count({ where: { status: "EXECUTED" } });
    expect(executed).toBe(2);
  });

  it("BUY de ativo novo: cria position do zero com avgPrice = preço da ordem", async () => {
    const app = makeApp(new StubQuotationClient({ BTC: 350000 }));
    await app.inject({
      method: "POST",
      url: "/orders",
      headers: authHeaders(),
      payload: { symbol: "BTC", side: "BUY", quantity: 0.01 },
    });
    await app.close();

    await processOne();

    const pos = await prisma.position.findUnique({
      where: { userId_symbol: { userId: TEST_USER, symbol: "BTC" } },
    });
    expect(pos?.quantity.toString()).toBe("0.01");
    expect(pos?.avgPrice.toString()).toBe("350000");
  });
});
