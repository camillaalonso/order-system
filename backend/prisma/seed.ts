import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const assets = [
  { symbol: "ITUB4", name: "Itaú Unibanco PN", referencePrice: "32.80" },
  { symbol: "ITUB3", name: "Itaú Unibanco ON", referencePrice: "15.40" },
  { symbol: "USDC", name: "USD Coin", referencePrice: "5.50" },
  { symbol: "SOL", name: "Solana", referencePrice: "418.07" },
  { symbol: "BTC", name: "Bitcoin", referencePrice: "350000.00" },
  { symbol: "ETH", name: "Ethereum", referencePrice: "18500.00" },
];

const demoUser = { id: "user-001", name: "Demo User", cashBalance: "10000.00" };

const demoPositions = [
  { symbol: "ITUB4", quantity: "100", avgPrice: "30.00" },
  { symbol: "USDC", quantity: "50", avgPrice: "3.94" },
];

async function main() {
  console.log("Cleaning transactional state...");
  const deletedOrders = await prisma.order.deleteMany({});
  const deletedPositions = await prisma.position.deleteMany({});
  console.log(`  ✓ deleted ${deletedOrders.count} orders, ${deletedPositions.count} positions`);

  console.log("Seeding assets...");

  for (const asset of assets) {
    await prisma.asset.upsert({
      where: { symbol: asset.symbol },
      create: asset,
      update: { name: asset.name, referencePrice: asset.referencePrice },
    });
    console.log(`  ✓ ${asset.symbol} (${asset.name})`);
  }

  console.log("Seeding demo user...");
  await prisma.user.upsert({
    where: { id: demoUser.id },
    create: demoUser,
    update: {
      name: demoUser.name,
      cashBalance: demoUser.cashBalance,
      reservedCash: "0",
    },
  });
  console.log(`  ✓ ${demoUser.id} (${demoUser.name}) cash=${demoUser.cashBalance}`);

  console.log("Seeding demo positions...");
  for (const pos of demoPositions) {
    await prisma.position.upsert({
      where: { userId_symbol: { userId: demoUser.id, symbol: pos.symbol } },
      create: { userId: demoUser.id, ...pos },
      update: {
        quantity: pos.quantity,
        avgPrice: pos.avgPrice,
        reservedQuantity: "0",
      },
    });
    console.log(`  ✓ ${pos.symbol} qty=${pos.quantity} avg=${pos.avgPrice}`);
  }

  console.log("Done.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
