-- AlterTable
ALTER TABLE "Instrument" ADD COLUMN     "splitsCheckedAt" TIMESTAMP(3),
ADD COLUMN     "splitsCheckedSource" TEXT;

-- CreateTable
CREATE TABLE "StockSplit" (
    "id" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "factor" DOUBLE PRECISION NOT NULL,
    "provider" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockSplit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockSplit_instrumentId_effectiveDate_provider_key" ON "StockSplit"("instrumentId", "effectiveDate", "provider");

-- AddForeignKey
ALTER TABLE "StockSplit" ADD CONSTRAINT "StockSplit_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
