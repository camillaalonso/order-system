-- CreateTable
CREATE TABLE "assets" (
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "referencePrice" DECIMAL(18,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("symbol")
);
