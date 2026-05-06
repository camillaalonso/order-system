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

async function createOrder(side: "BUY" | "SELL", quantity: number, price: number): Promise<string> {
  const app = makeApp(new StubQuotationClient({ ITUB4: price }));
  const res = await app.inject({
    method: "POST",
    url: "/orders",
    headers: authHeaders(),
    payload: { symbol: "ITUB4", side, quantity },
  });
  await app.close();
  return res.json().data.id;
}

describe("re-quote no worker (slice 7)", () => {
  beforeEach(async () => {
    await seedDefault();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("BUY: quote com queda de preço refunda excedente da reserva", async () => {
    const id = await createOrder("BUY", 10, 32.0); // reserva 320
    // Worker re-cota e vê 30. actualCost = 300. Refund 20.
    await processOne(new StubQuotationClient({ ITUB4: 30.0 }));

    const order = await prisma.order.findUnique({ where: { id } });
    expect(order?.status).toBe("EXECUTED");
    expect(order?.price.toString()).toBe("30");
    expect(order?.totalAmount.toString()).toBe("300");

    const user = await prisma.user.findUnique({ where: { id: TEST_USER } });
    expect(user?.cashBalance.toString()).toBe("9700"); // 10000 - 300
    expect(user?.reservedCash.toString()).toBe("0");
  });

  it("BUY: quote subiu mas dentro de 5% — executa ao preço gravado (cliente não cobra mais que pediu)", async () => {
    const id = await createOrder("BUY", 10, 32.0); // reserva 320
    // 32 * 1.05 = 33.6. 33 está dentro do tolerável mas acima do agreed.
    await processOne(new StubQuotationClient({ ITUB4: 33.0 }));
    const order = await prisma.order.findUnique({ where: { id } });
    expect(order?.status).toBe("EXECUTED");
    // Preço gravado mantido — limit-order semantics
    expect(order?.price.toString()).toBe("32");
    expect(order?.totalAmount.toString()).toBe("320");
  });

  it("BUY: quote acima de 5% rejeita → FAILED + libera reserva", async () => {
    const id = await createOrder("BUY", 10, 32.0); // reserva 320
    // 32 * 1.05 = 33.6. 35 está fora.
    await processOne(new StubQuotationClient({ ITUB4: 35.0 }));

    const order = await prisma.order.findUnique({ where: { id } });
    expect(order?.status).toBe("FAILED");
    expect(order?.failureReason).toMatch(/slippage/i);
    expect(order?.attempts).toBe(1);

    const user = await prisma.user.findUnique({ where: { id: TEST_USER } });
    expect(user?.cashBalance.toString()).toBe("10000");
    expect(user?.reservedCash.toString()).toBe("0");
  });

  it("SELL: quote abaixo de 5% rejeita → FAILED + libera reservedQuantity", async () => {
    const id = await createOrder("SELL", 10, 33.0);
    // 33 * 0.95 = 31.35. 30 está abaixo.
    await processOne(new StubQuotationClient({ ITUB4: 30.0 }));

    const order = await prisma.order.findUnique({ where: { id } });
    expect(order?.status).toBe("FAILED");
    expect(order?.failureReason).toMatch(/slippage/i);

    const pos = await prisma.position.findUnique({
      where: { userId_symbol: { userId: TEST_USER, symbol: "ITUB4" } },
    });
    expect(pos?.quantity.toString()).toBe("100");
    expect(pos?.reservedQuantity.toString()).toBe("0");
  });

  it("SELL: quote dentro da tolerância executa no novo preço", async () => {
    const id = await createOrder("SELL", 10, 33.0);
    // 33 * 0.95 = 31.35. 32 dentro.
    await processOne(new StubQuotationClient({ ITUB4: 32.0 }));
    const order = await prisma.order.findUnique({ where: { id } });
    expect(order?.status).toBe("EXECUTED");
    expect(order?.price.toString()).toBe("32");

    const user = await prisma.user.findUnique({ where: { id: TEST_USER } });
    expect(user?.cashBalance.toString()).toBe("10320"); // 10000 + 10*32
  });

  it("quote retorna null (falha): cai pra preço gravado, sem rejeição", async () => {
    const id = await createOrder("BUY", 10, 32.0);
    // StubQuotationClient sem priceMap → null pra qualquer symbol
    await processOne(new StubQuotationClient());
    const order = await prisma.order.findUnique({ where: { id } });
    expect(order?.status).toBe("EXECUTED");
    expect(order?.price.toString()).toBe("32"); // preço original mantido
  });
});

describe("retry transiente + max attempts (slice 7C)", () => {
  beforeEach(async () => {
    await seedDefault();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("OrderRejectedError marca FAILED na primeira tentativa (não tenta retry)", async () => {
    const id = await createOrder("BUY", 10, 32.0);
    await processOne(new StubQuotationClient({ ITUB4: 100.0 })); // muito acima do tolerável

    const order = await prisma.order.findUnique({ where: { id } });
    expect(order?.status).toBe("FAILED");
    expect(order?.attempts).toBe(1);
  });

  it("erro transiente (não rejeição) deixa PENDING e incrementa attempts; FALHA após 3", async () => {
    const id = await createOrder("BUY", 10, 32.0);
    // Quotation que sempre throws — simula um erro genérico (DB blip, etc).
    const flaky = {
      async getQuote(): Promise<never> {
        throw new Error("simulated transient fault");
      },
    };

    await processOne(flaky);
    let order = await prisma.order.findUnique({ where: { id } });
    expect(order?.status).toBe("PENDING");
    expect(order?.attempts).toBe(1);

    await processOne(flaky);
    order = await prisma.order.findUnique({ where: { id } });
    expect(order?.status).toBe("PENDING");
    expect(order?.attempts).toBe(2);

    await processOne(flaky);
    order = await prisma.order.findUnique({ where: { id } });
    expect(order?.status).toBe("FAILED");
    expect(order?.attempts).toBe(3);
    expect(order?.failureReason).toMatch(/transient fault/);

    // Reserva foi liberada porque BUY não chegou a consumir nada
    const user = await prisma.user.findUnique({ where: { id: TEST_USER } });
    expect(user?.cashBalance.toString()).toBe("10000");
    expect(user?.reservedCash.toString()).toBe("0");
  });
});
