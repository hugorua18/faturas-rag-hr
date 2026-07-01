-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SUBMETIDA',
    "source" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "supplierName" TEXT,
    "supplierNif" TEXT,
    "acquirerNif" TEXT,
    "documentType" TEXT,
    "documentDate" TEXT,
    "documentTime" TEXT,
    "amountBase" REAL,
    "amountVat" REAL,
    "amountTotal" REAL,
    "qrRawPayload" TEXT,
    "originalFilePath" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Expense_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Expense_status_idx" ON "Expense"("status");

-- CreateIndex
CREATE INDEX "Expense_documentDate_idx" ON "Expense"("documentDate");
