import { execSync } from "node:child_process";

export default async function setup() {
  try {
    execSync(
      `docker compose exec -T postgres psql -U orders -d orders -c "CREATE DATABASE orders_test;"`,
      { stdio: "pipe" },
    );
    console.log("[test setup] created database orders_test");
  } catch {
    // Already exists.
  }

  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: "postgresql://orders:orders@localhost:5432/orders_test",
    },
  });
}
