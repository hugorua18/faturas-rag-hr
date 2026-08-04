-- CreateTable
CREATE TABLE "AcquirerNifDisplay" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "acquirerNif" TEXT NOT NULL,
    "label" TEXT,
    "icon" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcquirerNifDisplay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AcquirerNifDisplay_userId_acquirerNif_key" ON "AcquirerNifDisplay"("userId", "acquirerNif");

-- AddForeignKey
ALTER TABLE "AcquirerNifDisplay" ADD CONSTRAINT "AcquirerNifDisplay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
