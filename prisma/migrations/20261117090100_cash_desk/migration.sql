-- CreateEnum
CREATE TYPE "CashEntryKind" AS ENUM ('income', 'expense', 'transfer', 'correction');

-- CreateEnum
CREATE TYPE "CashDirection" AS ENUM ('kindergarten', 'school', 'shared');

-- CreateEnum
CREATE TYPE "CashExpenseCategory" AS ENUM ('household', 'materials', 'supplier', 'refund', 'other');

-- CreateEnum
CREATE TYPE "CashTransferStatus" AS ENUM ('pending', 'confirmed', 'disputed');

-- CreateEnum
CREATE TYPE "CashAlertType" AS ENUM ('shift_closed', 'discrepancy', 'opening_discrepancy', 'large_withdrawal', 'payment_void', 'correction', 'transfer_disputed');

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "payerName" TEXT,
ADD COLUMN     "periodFrom" DATE,
ADD COLUMN     "periodTo" DATE;

-- CreateTable
CREATE TABLE "CashDesk" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "largeAmount" DECIMAL(10,2) NOT NULL DEFAULT 5000.00,
    "closeBy" TEXT NOT NULL DEFAULT '20:00',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashDesk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashShift" (
    "id" TEXT NOT NULL,
    "deskId" TEXT NOT NULL,
    "openedById" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openingExpected" DECIMAL(10,2) NOT NULL,
    "openingCounted" DECIMAL(10,2) NOT NULL,
    "openingNote" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "closingExpected" DECIMAL(10,2),
    "closingCounted" DECIMAL(10,2),
    "denominations" JSONB,
    "closingNote" TEXT,
    "totals" JSONB,

    CONSTRAINT "CashShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashEntry" (
    "id" TEXT NOT NULL,
    "deskId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "kind" "CashEntryKind" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "direction" "CashDirection" NOT NULL,
    "expenseCategory" "CashExpenseCategory",
    "paymentId" TEXT,
    "recipientId" TEXT,
    "transferStatus" "CashTransferStatus",
    "transferNote" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "sign" INTEGER NOT NULL DEFAULT 1,
    "correctsId" TEXT,
    "comment" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,

    CONSTRAINT "CashEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashAlert" (
    "id" TEXT NOT NULL,
    "deskId" TEXT NOT NULL,
    "shiftId" TEXT,
    "entryId" TEXT,
    "type" "CashAlertType" NOT NULL,
    "amount" DECIMAL(10,2),
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" TEXT,

    CONSTRAINT "CashAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CashDesk_name_key" ON "CashDesk"("name");

-- CreateIndex
CREATE INDEX "CashShift_deskId_openedAt_idx" ON "CashShift"("deskId", "openedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CashEntry_paymentId_key" ON "CashEntry"("paymentId");

-- CreateIndex
CREATE INDEX "CashEntry_shiftId_idx" ON "CashEntry"("shiftId");

-- CreateIndex
CREATE INDEX "CashEntry_recipientId_transferStatus_idx" ON "CashEntry"("recipientId", "transferStatus");

-- CreateIndex
CREATE INDEX "CashAlert_acknowledgedAt_idx" ON "CashAlert"("acknowledgedAt");

-- AddForeignKey
ALTER TABLE "CashShift" ADD CONSTRAINT "CashShift_deskId_fkey" FOREIGN KEY ("deskId") REFERENCES "CashDesk"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashShift" ADD CONSTRAINT "CashShift_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashShift" ADD CONSTRAINT "CashShift_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashEntry" ADD CONSTRAINT "CashEntry_deskId_fkey" FOREIGN KEY ("deskId") REFERENCES "CashDesk"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashEntry" ADD CONSTRAINT "CashEntry_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "CashShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashEntry" ADD CONSTRAINT "CashEntry_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashEntry" ADD CONSTRAINT "CashEntry_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashEntry" ADD CONSTRAINT "CashEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashEntry" ADD CONSTRAINT "CashEntry_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashAlert" ADD CONSTRAINT "CashAlert_deskId_fkey" FOREIGN KEY ("deskId") REFERENCES "CashDesk"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashAlert" ADD CONSTRAINT "CashAlert_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "CashShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashAlert" ADD CONSTRAINT "CashAlert_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "CashEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashAlert" ADD CONSTRAINT "CashAlert_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashAlert" ADD CONSTRAINT "CashAlert_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- CreateIndex
CREATE UNIQUE INDEX "CashShift_one_open_per_desk" ON "CashShift"("deskId") WHERE "closedAt" IS NULL;

-- Seed
INSERT INTO "CashDesk" (id, name, "isActive", "largeAmount", "closeBy", "createdAt") VALUES (gen_random_uuid(), 'Каса', true, 5000.00, '20:00', now());
