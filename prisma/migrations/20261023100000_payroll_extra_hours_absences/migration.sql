-- AlterEnum
ALTER TYPE "PayrollLineType" ADD VALUE 'extra_hours';

-- AlterTable
ALTER TABLE "SalaryTerms" ADD COLUMN     "extraHourRate" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "payrollDetailsVisible" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PayrollExtraHours" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "date" DATE,
    "hours" DECIMAL(6,2) NOT NULL,
    "comment" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,

    CONSTRAINT "PayrollExtraHours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeacherAbsence" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "paid" BOOLEAN NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,

    CONSTRAINT "TeacherAbsence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayrollExtraHours_teacherId_month_idx" ON "PayrollExtraHours"("teacherId", "month");

-- CreateIndex
CREATE INDEX "TeacherAbsence_teacherId_startDate_idx" ON "TeacherAbsence"("teacherId", "startDate");

-- AddForeignKey
ALTER TABLE "PayrollExtraHours" ADD CONSTRAINT "PayrollExtraHours_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollExtraHours" ADD CONSTRAINT "PayrollExtraHours_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollExtraHours" ADD CONSTRAINT "PayrollExtraHours_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherAbsence" ADD CONSTRAINT "TeacherAbsence_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherAbsence" ADD CONSTRAINT "TeacherAbsence_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherAbsence" ADD CONSTRAINT "TeacherAbsence_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

