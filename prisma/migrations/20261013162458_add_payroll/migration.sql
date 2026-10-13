-- CreateEnum
CREATE TYPE "PayrollCalendar" AS ENUM ('all', 'kindergarten', 'school_class');

-- CreateEnum
CREATE TYPE "PayrollLessonType" AS ENUM ('school_lesson', 'class_group', 'individual');

-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('draft', 'approved');

-- CreateEnum
CREATE TYPE "PayrollLineType" AS ENUM ('base', 'allowance', 'lesson', 'correction', 'adjustment');

-- CreateEnum
CREATE TYPE "PayrollSourceType" AS ENUM ('school_lesson', 'class_lesson');

-- CreateEnum
CREATE TYPE "PayrollAdjustmentKind" AS ENUM ('bonus', 'deduction');

-- CreateEnum
CREATE TYPE "PayrollPaymentMethod" AS ENUM ('cash', 'card');

-- CreateTable
CREATE TABLE "SalaryTerms" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "monthlyRate" DECIMAL(12,2) NOT NULL,
    "calendarKind" "PayrollCalendar" NOT NULL DEFAULT 'all',
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalaryTerms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryRate" (
    "id" TEXT NOT NULL,
    "termsId" TEXT NOT NULL,
    "lessonType" "PayrollLessonType" NOT NULL,
    "subjectId" TEXT,
    "classGroupId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "SalaryRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryAllowance" (
    "id" TEXT NOT NULL,
    "termsId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "SalaryAllowance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollSheet" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "status" "PayrollStatus" NOT NULL DEFAULT 'draft',
    "workedDays" INTEGER,
    "approvedDays" JSONB,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "reopenedById" TEXT,
    "reopenReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollSheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollLine" (
    "id" TEXT NOT NULL,
    "sheetId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "type" "PayrollLineType" NOT NULL,
    "sourceType" "PayrollSourceType",
    "sourceId" TEXT,
    "lessonType" "PayrollLessonType",
    "date" DATE,
    "refMonth" DATE,
    "title" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "meta" JSONB,

    CONSTRAINT "PayrollLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollAdjustment" (
    "id" TEXT NOT NULL,
    "sheetId" TEXT NOT NULL,
    "kind" "PayrollAdjustmentKind" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,

    CONSTRAINT "PayrollAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollPayment" (
    "id" TEXT NOT NULL,
    "sheetId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "PayrollPaymentMethod" NOT NULL,
    "comment" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,

    CONSTRAINT "PayrollPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalaryTerms_teacherId_validFrom_idx" ON "SalaryTerms"("teacherId", "validFrom");

-- CreateIndex
CREATE INDEX "SalaryRate_termsId_idx" ON "SalaryRate"("termsId");

-- CreateIndex
CREATE INDEX "SalaryAllowance_termsId_idx" ON "SalaryAllowance"("termsId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollSheet_teacherId_month_key" ON "PayrollSheet"("teacherId", "month");

-- CreateIndex
CREATE INDEX "PayrollLine_sheetId_idx" ON "PayrollLine"("sheetId");

-- CreateIndex
CREATE INDEX "PayrollLine_sourceType_sourceId_idx" ON "PayrollLine"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "PayrollAdjustment_sheetId_idx" ON "PayrollAdjustment"("sheetId");

-- CreateIndex
CREATE INDEX "PayrollPayment_sheetId_idx" ON "PayrollPayment"("sheetId");

-- AddForeignKey
ALTER TABLE "SalaryTerms" ADD CONSTRAINT "SalaryTerms_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryTerms" ADD CONSTRAINT "SalaryTerms_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryRate" ADD CONSTRAINT "SalaryRate_termsId_fkey" FOREIGN KEY ("termsId") REFERENCES "SalaryTerms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryRate" ADD CONSTRAINT "SalaryRate_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryRate" ADD CONSTRAINT "SalaryRate_classGroupId_fkey" FOREIGN KEY ("classGroupId") REFERENCES "ClassGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryAllowance" ADD CONSTRAINT "SalaryAllowance_termsId_fkey" FOREIGN KEY ("termsId") REFERENCES "SalaryTerms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollSheet" ADD CONSTRAINT "PayrollSheet_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollSheet" ADD CONSTRAINT "PayrollSheet_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollSheet" ADD CONSTRAINT "PayrollSheet_reopenedById_fkey" FOREIGN KEY ("reopenedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollLine" ADD CONSTRAINT "PayrollLine_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "PayrollSheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollAdjustment" ADD CONSTRAINT "PayrollAdjustment_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "PayrollSheet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollAdjustment" ADD CONSTRAINT "PayrollAdjustment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollAdjustment" ADD CONSTRAINT "PayrollAdjustment_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPayment" ADD CONSTRAINT "PayrollPayment_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "PayrollSheet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPayment" ADD CONSTRAINT "PayrollPayment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPayment" ADD CONSTRAINT "PayrollPayment_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
