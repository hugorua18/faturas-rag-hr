-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "vatDeductible" BOOLEAN;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "vatAutoFillMode" TEXT,
ADD COLUMN     "vatClassificationEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SupplierVatDefault" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "supplierNif" TEXT NOT NULL,
    "vatDeductible" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierVatDefault_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierVatDefault_userId_supplierNif_key" ON "SupplierVatDefault"("userId", "supplierNif");

-- AddForeignKey
ALTER TABLE "SupplierVatDefault" ADD CONSTRAINT "SupplierVatDefault_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
