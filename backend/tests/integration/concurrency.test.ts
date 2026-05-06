import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/infra/db/prisma.js";
import {
  StubQuotationClient,
  authHeaders,
  makeApp,
  seedDefault,
  TEST_USER,
} from "./helpers.js";

describe("concurrência (cenário João/ITUB4 do README)", () => {
  beforeEach(async () => {
    await seedDefault();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("2 SELLs paralelas de 80 sobre quantity=100: uma vira PENDING, outra 422", async () => {
    const app = makeApp(new StubQuotationClient({ ITUB4: 33 }));

    const [a, b] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/orders",
        headers: authHeaders(),
        payload: { symbol: "ITUB4", side: "SELL", quantity: 80 },
      }),
      app.inject({
        method: "POST",
        url: "/orders",
        headers: authHeaders(),
        payload: { symbol: "ITUB4", side: "SELL", quantity: 80 },
      }),
    ]);

    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([201, 422]);

    const failed = a.statusCode === 422 ? a : b;
    expect(failed.json().error).toBe("insufficient_asset");

    const pos = await prisma.position.findUnique({
      where: { userId_symbol: { userId: TEST_USER, symbol: "ITUB4" } },
    });
    expect(pos?.quantity.toString()).toBe("20");
    expect(pos?.reservedQuantity.toString()).toBe("80");

    const orderCount = await prisma.order.count();
    expect(orderCount).toBe(1);

    await app.close();
  });

  it("10 BUYs paralelos: todos viram PENDING e o cash reservado bate", async () => {
    const app = makeApp(new StubQuotationClient({ ITUB4: 32.0 }));

    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        app.inject({
          method: "POST",
          url: "/orders",
          headers: authHeaders(),
          payload: { symbol: "ITUB4", side: "BUY", quantity: 1 },
        }),
      ),
    );

    expect(responses.every((r) => r.statusCode === 201)).toBe(true);
    expect(responses.every((r) => r.json().data.status === "PENDING")).toBe(true);

    const user = await prisma.user.findUnique({ where: { id: TEST_USER } });
    expect(user?.cashBalance.toString()).toBe("9680");
    expect(user?.reservedCash.toString()).toBe("320");

    const orderCount = await prisma.order.count({ where: { status: "PENDING" } });
    expect(orderCount).toBe(10);

    await app.close();
  });

  it("BUYs paralelos onde só 5 cabem no saldo: aceita 5 e rejeita 5", async () => {
    const app = makeApp(new StubQuotationClient({ ITUB4: 32.0 }));

    // Reseta o user com saldo de 160 (= 5 BUYs de 32)
    await prisma.user.update({
      where: { id: TEST_USER },
      data: { cashBalance: "160" },
    });

    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        app.inject({
          method: "POST",
          url: "/orders",
          headers: authHeaders(),
          payload: { symbol: "ITUB4", side: "BUY", quantity: 1 },
        }),
      ),
    );

    const accepted = responses.filter((r) => r.statusCode === 201).length;
    const rejected = responses.filter((r) => r.statusCode === 422).length;
    expect(accepted).toBe(5);
    expect(rejected).toBe(5);

    const user = await prisma.user.findUnique({ where: { id: TEST_USER } });
    expect(user?.cashBalance.toString()).toBe("0");
    expect(user?.reservedCash.toString()).toBe("160");

    await app.close();
  });
});
