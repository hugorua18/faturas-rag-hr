-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Expense" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SUBMETIDA',
    "source" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "supplierName" TEXT,
    "supplierNif" TEXT,
    "acquirerNif" TEXT,
    "documentType" TEXT,
    "documentId" TEXT,
    "documentDate" TEXT,
    "documentTime" TEXT,
    "amountBase" REAL,
    "amountVat" REAL,
    "amountTotal" REAL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "originalAmountBase" REAL,
    "originalAmountVat" REAL,
    "originalAmountTotal" REAL,
    "qrRawPayload" TEXT,
    "originalFilePath" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Expense_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Expense" ("acquirerNif", "amountBase", "amountTotal", "amountVat", "createdAt", "documentDate", "documentId", "documentTime", "documentType", "id", "originalFilePath", "qrRawPayload", "source", "status", "supplierName", "supplierNif", "type", "updatedAt", "userId") SELECT "acquirerNif", "amountBase", "amountTotal", "amountVat", "createdAt", "documentDate", "documentId", "documentTime", "documentType", "id", "originalFilePath", "qrRawPayload", "source", "status", "supplierName", "supplierNif", "type", "updatedAt", "userId" FROM "Expense";
DROP TABLE "Expense";
ALTER TABLE "new_Expense" RENAME TO "Expense";
CREATE INDEX "Expense_status_idx" ON "Expense"("status");
CREATE INDEX "Expense_documentDate_idx" ON "Expense"("documentDate");
CREATE INDEX "Expense_supplierNif_documentId_idx" ON "Expense"("supplierNif", "documentId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
