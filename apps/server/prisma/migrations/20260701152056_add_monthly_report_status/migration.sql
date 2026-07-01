-- CreateTable
CREATE TABLE "MonthlyReportStatus" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "acquirerNif" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ABERTO',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyReportStatus_acquirerNif_period_key" ON "MonthlyReportStatus"("acquirerNif", "period");
