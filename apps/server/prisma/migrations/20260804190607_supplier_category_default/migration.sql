-- CreateTable
CREATE TABLE "SupplierCategoryDefault" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "supplierNif" TEXT NOT NULL,
    "categoryKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierCategoryDefault_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierCategoryDefault_userId_supplierNif_key" ON "SupplierCategoryDefault"("userId", "supplierNif");

-- AddForeignKey
ALTER TABLE "SupplierCategoryDefault" ADD CONSTRAINT "SupplierCategoryDefault_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
