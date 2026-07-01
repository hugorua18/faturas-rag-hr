-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MonthlyReportStatus" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "acquirerNif" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ABERTO',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MonthlyReportStatus_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_MonthlyReportStatus" ("acquirerNif", "createdAt", "id", "period", "status", "updatedAt") SELECT "acquirerNif", "createdAt", "id", "period", "status", "updatedAt" FROM "MonthlyReportStatus";
DROP TABLE "MonthlyReportStatus";
ALTER TABLE "new_MonthlyReportStatus" RENAME TO "MonthlyReportStatus";
CREATE UNIQUE INDEX "MonthlyReportStatus_userId_acquirerNif_period_key" ON "MonthlyReportStatus"("userId", "acquirerNif", "period");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
