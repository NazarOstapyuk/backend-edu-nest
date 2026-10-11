-- CreateEnum
CREATE TYPE "TariffUnit" AS ENUM ('month', 'hour', 'session', 'package');

-- CreateEnum
CREATE TYPE "BillingMode" AS ENUM ('anniversary', 'calendar_prorated', 'calendar_full');

-- CreateEnum
CREATE TYPE "AdjustmentType" AS ENUM ('custom_price', 'discount_percent', 'discount_amount', 'pause');

-- CreateTable
CREATE TABLE "Tariff" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "FinanceCategory" NOT NULL,
    "unit" "TariffUnit" NOT NULL,
    "packageSize" INTEGER,
    "billingMode" "BillingMode" NOT NULL DEFAULT 'calendar_full',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tariff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TariffPrice" (
    "id" TEXT NOT NULL,
    "tariffId" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TariffPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Enrollment" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "tariffId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "billingMode" "BillingMode",
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Enrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnrollmentAdjustment" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "type" "AdjustmentType" NOT NULL,
    "value" DECIMAL(10,2),
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "reason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,

    CONSTRAINT "EnrollmentAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BilledPeriod" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "chargeId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BilledPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdaptationVisit" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "tariffId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "hours" DECIMAL(5,2) NOT NULL,
    "ratePerHour" DECIMAL(10,2) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "note" TEXT,
    "chargeId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,

    CONSTRAINT "AdaptationVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tariff_name_key" ON "Tariff"("name");

-- CreateIndex
CREATE UNIQUE INDEX "TariffPrice_tariffId_effectiveFrom_key" ON "TariffPrice"("tariffId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "Enrollment_childId_idx" ON "Enrollment"("childId");

-- CreateIndex
CREATE INDEX "EnrollmentAdjustment_enrollmentId_idx" ON "EnrollmentAdjustment"("enrollmentId");

-- CreateIndex
CREATE UNIQUE INDEX "BilledPeriod_chargeId_key" ON "BilledPeriod"("chargeId");

-- CreateIndex
CREATE UNIQUE INDEX "BilledPeriod_enrollmentId_periodStart_key" ON "BilledPeriod"("enrollmentId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "AdaptationVisit_chargeId_key" ON "AdaptationVisit"("chargeId");

-- CreateIndex
CREATE INDEX "AdaptationVisit_childId_idx" ON "AdaptationVisit"("childId");

-- AddForeignKey
ALTER TABLE "TariffPrice" ADD CONSTRAINT "TariffPrice_tariffId_fkey" FOREIGN KEY ("tariffId") REFERENCES "Tariff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TariffPrice" ADD CONSTRAINT "TariffPrice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Child"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_tariffId_fkey" FOREIGN KEY ("tariffId") REFERENCES "Tariff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrollmentAdjustment" ADD CONSTRAINT "EnrollmentAdjustment_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrollmentAdjustment" ADD CONSTRAINT "EnrollmentAdjustment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrollmentAdjustment" ADD CONSTRAINT "EnrollmentAdjustment_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BilledPeriod" ADD CONSTRAINT "BilledPeriod_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BilledPeriod" ADD CONSTRAINT "BilledPeriod_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "Charge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdaptationVisit" ADD CONSTRAINT "AdaptationVisit_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Child"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdaptationVisit" ADD CONSTRAINT "AdaptationVisit_tariffId_fkey" FOREIGN KEY ("tariffId") REFERENCES "Tariff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdaptationVisit" ADD CONSTRAINT "AdaptationVisit_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "Charge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdaptationVisit" ADD CONSTRAINT "AdaptationVisit_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdaptationVisit" ADD CONSTRAINT "AdaptationVisit_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
