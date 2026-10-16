-- CreateEnum
CREATE TYPE "PaymentRequestSource" AS ENUM ('cabinet', 'link');

-- CreateEnum
CREATE TYPE "PaymentRequestStatus" AS ENUM ('open', 'paid', 'cancelled', 'expired');

-- CreateEnum
CREATE TYPE "PaymentProviderKind" AS ENUM ('test', 'monobank');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('pending', 'success', 'failure', 'expired');

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'card';

-- CreateTable
CREATE TABLE "PaymentRequest" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "category" "FinanceCategory" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "source" "PaymentRequestSource" NOT NULL,
    "status" "PaymentRequestStatus" NOT NULL DEFAULT 'open',
    "linkTokenHash" TEXT,
    "comment" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,

    CONSTRAINT "PaymentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentInvoice" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "provider" "PaymentProviderKind" NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "pageUrl" TEXT NOT NULL,
    "amountKop" INTEGER NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'pending',
    "failureReason" TEXT,
    "paidAt" TIMESTAMP(3),
    "checkedAt" TIMESTAMP(3),
    "paymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRequest_linkTokenHash_key" ON "PaymentRequest"("linkTokenHash");

-- CreateIndex
CREATE INDEX "PaymentRequest_childId_idx" ON "PaymentRequest"("childId");

-- CreateIndex
CREATE INDEX "PaymentRequest_status_idx" ON "PaymentRequest"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentInvoice_invoiceId_key" ON "PaymentInvoice"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentInvoice_paymentId_key" ON "PaymentInvoice"("paymentId");

-- CreateIndex
CREATE INDEX "PaymentInvoice_requestId_idx" ON "PaymentInvoice"("requestId");

-- CreateIndex
CREATE INDEX "PaymentInvoice_status_idx" ON "PaymentInvoice"("status");

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Child"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentInvoice" ADD CONSTRAINT "PaymentInvoice_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PaymentRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentInvoice" ADD CONSTRAINT "PaymentInvoice_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
