-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('STOCK', 'ETF', 'CRYPTO', 'INDEX_PROXY', 'OTHER');

-- CreateEnum
CREATE TYPE "TxSide" AS ENUM ('BUY', 'SELL', 'DIVIDEND');

-- CreateEnum
CREATE TYPE "BarInterval" AS ENUM ('DAY', 'WEEK');

-- CreateEnum
CREATE TYPE "FetchStatus" AS ENUM ('SUCCESS', 'PARTIAL', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "CashMovementType" AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "Instrument" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "assetType" "AssetType" NOT NULL,
    "exchange" TEXT,
    "currency" TEXT NOT NULL,
    "isin" TEXT,
    "sector" TEXT,
    "industry" TEXT,
    "country" TEXT,
    "providerIds" JSONB NOT NULL DEFAULT '{}',
    "businessModel" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "onWatchlist" BOOLEAN NOT NULL DEFAULT false,
    "inBreadthUniverse" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Instrument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PositionMeta" (
    "id" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "thesis" TEXT,
    "horizon" TEXT,
    "rebuyMarks" JSONB NOT NULL DEFAULT '[]',
    "targetWeightPct" DOUBLE PRECISION,
    "maxWeightPct" DOUBLE PRECISION,
    "riskNotes" TEXT,
    "notes" TEXT,
    "preference" TEXT,
    "preferenceNote" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PositionMeta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "side" "TxSide" NOT NULL,
    "tradeDate" DATE NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "priceCurrency" TEXT NOT NULL,
    "fees" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "feeCurrency" TEXT,
    "fxToBase" DOUBLE PRECISION,
    "fxSource" TEXT,
    "venue" TEXT,
    "note" TEXT,
    "importBatchId" TEXT,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "filename" TEXT,
    "rowsTotal" INTEGER NOT NULL,
    "accepted" INTEGER NOT NULL,
    "rejected" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashMovement" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "type" "CashMovementType" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "note" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavingsPlan" (
    "id" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "interval" TEXT NOT NULL,
    "dayOfMonth" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startDate" DATE NOT NULL,
    "note" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SavingsPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlannedTranche" (
    "id" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "triggerPrice" DOUBLE PRECISION,
    "currency" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OFFEN',
    "condition" TEXT,
    "note" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlannedTranche_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManualLevel" (
    "id" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "kind" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManualLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThesisEvent" (
    "id" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ThesisEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ValuationModel" (
    "id" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "assumptions" JSONB NOT NULL,
    "note" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ValuationModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceBar" (
    "id" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "interval" "BarInterval" NOT NULL,
    "date" DATE NOT NULL,
    "open" DOUBLE PRECISION,
    "high" DOUBLE PRECISION,
    "low" DOUBLE PRECISION,
    "close" DOUBLE PRECISION NOT NULL,
    "volume" DOUBLE PRECISION,
    "currency" TEXT NOT NULL,
    "adjusted" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PriceBar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "last" DOUBLE PRECISION,
    "bid" DOUBLE PRECISION,
    "ask" DOUBLE PRECISION,
    "quoteTime" TIMESTAMP(3),
    "delayMinutes" INTEGER,
    "venue" TEXT,
    "currency" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MacroSeries" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "originalSource" TEXT,
    "sourceUrl" TEXT,
    "frequency" TEXT NOT NULL,

    CONSTRAINT "MacroSeries_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "MacroObservation" (
    "id" TEXT NOT NULL,
    "seriesKey" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "value" DOUBLE PRECISION,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "provider" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "MacroObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fundamental" (
    "id" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "periodEnd" DATE NOT NULL,
    "periodType" TEXT NOT NULL,
    "fiscalYear" INTEGER,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "isEstimate" BOOLEAN NOT NULL DEFAULT false,
    "filedAt" TIMESTAMP(3),
    "provider" TEXT NOT NULL,
    "sourceRef" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Fundamental_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EarningsEvent" (
    "id" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "reportDate" DATE NOT NULL,
    "fiscalPeriodEnd" DATE,
    "timeOfDay" TEXT,
    "epsEstimate" DOUBLE PRECISION,
    "currency" TEXT,
    "dateIsEstimated" BOOLEAN NOT NULL DEFAULT true,
    "provider" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "EarningsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalystAction" (
    "id" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "firm" TEXT,
    "action" TEXT NOT NULL,
    "fromRating" TEXT,
    "toRating" TEXT,
    "priceTarget" DOUBLE PRECISION,
    "provider" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AnalystAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsiderTransaction" (
    "id" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "insiderName" TEXT NOT NULL,
    "role" TEXT,
    "transactionDate" DATE,
    "filedAt" TIMESTAMP(3),
    "type" TEXT NOT NULL,
    "shares" DOUBLE PRECISION,
    "price" DOUBLE PRECISION,
    "provider" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "dedupeKey" TEXT NOT NULL,

    CONSTRAINT "InsiderTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstitutionalHolding" (
    "id" TEXT NOT NULL,
    "filerName" TEXT NOT NULL,
    "filerCik" TEXT,
    "symbol" TEXT NOT NULL,
    "reportPeriod" DATE NOT NULL,
    "filedAt" TIMESTAMP(3),
    "shares" DOUBLE PRECISION,
    "valueUsd" DOUBLE PRECISION,
    "changeShares" DOUBLE PRECISION,
    "provider" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstitutionalHolding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundFlow" (
    "id" TEXT NOT NULL,
    "fundTicker" TEXT NOT NULL,
    "issuer" TEXT,
    "assetClass" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "netFlow" DOUBLE PRECISION,
    "flowUnit" TEXT NOT NULL DEFAULT 'USD_MILLION',
    "aum" DOUBLE PRECISION,
    "volume" DOUBLE PRECISION,
    "closePrice" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'UNBESTÄTIGT',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "provider" TEXT NOT NULL,
    "sourceRef" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "FundFlow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoliticianFiling" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "chamber" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "filerName" TEXT NOT NULL,
    "filingType" TEXT NOT NULL,
    "stateDistrict" TEXT,
    "year" INTEGER,
    "filedDate" DATE,
    "publishedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceUrl" TEXT,
    "rawText" TEXT,
    "contentHash" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'OFFIZIELLE_QUELLE_GEFUNDEN',
    "lastError" TEXT,

    CONSTRAINT "PoliticianFiling_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoliticianTransaction" (
    "id" TEXT NOT NULL,
    "filingId" TEXT,
    "source" TEXT NOT NULL,
    "politicianName" TEXT NOT NULL,
    "bioguideId" TEXT,
    "chamber" TEXT NOT NULL,
    "party" TEXT,
    "state" TEXT,
    "owner" TEXT NOT NULL,
    "assetName" TEXT NOT NULL,
    "ticker" TEXT,
    "tickerSource" TEXT,
    "instrumentKind" TEXT NOT NULL,
    "txType" TEXT NOT NULL,
    "transactionDate" DATE,
    "notificationDate" DATE,
    "filedDate" DATE,
    "publishedDate" DATE,
    "amountMin" DOUBLE PRECISION,
    "amountMax" DOUBLE PRECISION,
    "amountText" TEXT,
    "rawText" TEXT,
    "status" TEXT NOT NULL,
    "sourceFilingStatus" TEXT,
    "extractionConfidence" DOUBLE PRECISION,
    "uncertaintyFlags" JSONB NOT NULL DEFAULT '[]',
    "dedupeKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersededById" TEXT,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PoliticianTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceCoverage" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "institution" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "periodsChecked" TEXT,
    "lastSuccessAt" TIMESTAMP(3),
    "docsFound" INTEGER NOT NULL DEFAULT 0,
    "docsProcessed" INTEGER NOT NULL DEFAULT 0,
    "txExtracted" INTEGER NOT NULL DEFAULT 0,
    "docsPending" INTEGER NOT NULL DEFAULT 0,
    "knownGaps" TEXT,
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "lastCompletedAt" TIMESTAMP(3),

    CONSTRAINT "SourceCoverage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialPost" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "text" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "isRepost" BOOLEAN NOT NULL DEFAULT false,
    "hasMedia" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderState" (
    "providerId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSuccessAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderState_pkey" PRIMARY KEY ("providerId")
);

-- CreateTable
CREATE TABLE "FetchLog" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "dataset" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "status" "FetchStatus" NOT NULL,
    "recordsReceived" INTEGER NOT NULL DEFAULT 0,
    "recordsProcessed" INTEGER NOT NULL DEFAULT 0,
    "httpStatus" INTEGER,
    "errorMessage" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "nextAttemptAt" TIMESTAMP(3),

    CONSTRAINT "FetchLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Instrument_symbol_key" ON "Instrument"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "PositionMeta_instrumentId_key" ON "PositionMeta"("instrumentId");

-- CreateIndex
CREATE INDEX "Transaction_instrumentId_tradeDate_idx" ON "Transaction"("instrumentId", "tradeDate");

-- CreateIndex
CREATE INDEX "PriceBar_instrumentId_interval_date_idx" ON "PriceBar"("instrumentId", "interval", "date");

-- CreateIndex
CREATE UNIQUE INDEX "PriceBar_instrumentId_interval_date_provider_key" ON "PriceBar"("instrumentId", "interval", "date", "provider");

-- CreateIndex
CREATE INDEX "Quote_instrumentId_fetchedAt_idx" ON "Quote"("instrumentId", "fetchedAt");

-- CreateIndex
CREATE INDEX "MacroObservation_seriesKey_date_idx" ON "MacroObservation"("seriesKey", "date");

-- CreateIndex
CREATE UNIQUE INDEX "MacroObservation_seriesKey_date_provider_key" ON "MacroObservation"("seriesKey", "date", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "Fundamental_instrumentId_metric_periodEnd_periodType_provid_key" ON "Fundamental"("instrumentId", "metric", "periodEnd", "periodType", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "EarningsEvent_instrumentId_reportDate_provider_key" ON "EarningsEvent"("instrumentId", "reportDate", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "InsiderTransaction_dedupeKey_key" ON "InsiderTransaction"("dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "InstitutionalHolding_filerName_symbol_reportPeriod_provider_key" ON "InstitutionalHolding"("filerName", "symbol", "reportPeriod", "provider");

-- CreateIndex
CREATE INDEX "FundFlow_assetClass_date_idx" ON "FundFlow"("assetClass", "date");

-- CreateIndex
CREATE UNIQUE INDEX "FundFlow_fundTicker_date_provider_key" ON "FundFlow"("fundTicker", "date", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "PoliticianFiling_source_docId_version_key" ON "PoliticianFiling"("source", "docId", "version");

-- CreateIndex
CREATE INDEX "PoliticianTransaction_ticker_idx" ON "PoliticianTransaction"("ticker");

-- CreateIndex
CREATE INDEX "PoliticianTransaction_politicianName_idx" ON "PoliticianTransaction"("politicianName");

-- CreateIndex
CREATE UNIQUE INDEX "PoliticianTransaction_dedupeKey_version_key" ON "PoliticianTransaction"("dedupeKey", "version");

-- CreateIndex
CREATE UNIQUE INDEX "SourceCoverage_provider_institution_docType_key" ON "SourceCoverage"("provider", "institution", "docType");

-- CreateIndex
CREATE UNIQUE INDEX "SocialPost_platform_postId_key" ON "SocialPost"("platform", "postId");

-- CreateIndex
CREATE INDEX "FetchLog_providerId_startedAt_idx" ON "FetchLog"("providerId", "startedAt");

-- AddForeignKey
ALTER TABLE "PositionMeta" ADD CONSTRAINT "PositionMeta_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavingsPlan" ADD CONSTRAINT "SavingsPlan_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlannedTranche" ADD CONSTRAINT "PlannedTranche_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualLevel" ADD CONSTRAINT "ManualLevel_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThesisEvent" ADD CONSTRAINT "ThesisEvent_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValuationModel" ADD CONSTRAINT "ValuationModel_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceBar" ADD CONSTRAINT "PriceBar_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MacroObservation" ADD CONSTRAINT "MacroObservation_seriesKey_fkey" FOREIGN KEY ("seriesKey") REFERENCES "MacroSeries"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fundamental" ADD CONSTRAINT "Fundamental_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EarningsEvent" ADD CONSTRAINT "EarningsEvent_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalystAction" ADD CONSTRAINT "AnalystAction_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsiderTransaction" ADD CONSTRAINT "InsiderTransaction_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoliticianTransaction" ADD CONSTRAINT "PoliticianTransaction_filingId_fkey" FOREIGN KEY ("filingId") REFERENCES "PoliticianFiling"("id") ON DELETE SET NULL ON UPDATE CASCADE;
