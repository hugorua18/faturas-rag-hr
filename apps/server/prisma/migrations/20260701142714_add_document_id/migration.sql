-- AlterTable
ALTER TABLE "Expense" ADD COLUMN "documentId" TEXT;

-- CreateIndex
CREATE INDEX "Expense_supplierNif_documentId_idx" ON "Expense"("supplierNif", "documentId");
