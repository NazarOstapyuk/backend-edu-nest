-- CreateEnum
CREATE TYPE "GroupKind" AS ENUM ('kindergarten', 'school_class');

-- CreateEnum
CREATE TYPE "DailyStatus" AS ENUM ('present', 'late', 'left_early', 'absent');

-- CreateEnum
CREATE TYPE "CalendarDayType" AS ENUM ('non_working', 'working');

-- CreateEnum
CREATE TYPE "CalendarScope" AS ENUM ('all', 'kindergarten', 'school_class', 'group');

-- CreateEnum
CREATE TYPE "NoticeStatus" AS ENUM ('pending', 'approved', 'rejected', 'cancelled');

-- AlterTable
ALTER TABLE "Group" ADD COLUMN     "kind" "GroupKind" NOT NULL DEFAULT 'kindergarten';

-- CreateTable
CREATE TABLE "AbsenceReason" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "excused" BOOLEAN NOT NULL,
    "requiresDocument" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AbsenceReason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarDay" (
    "id" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "type" "CalendarDayType" NOT NULL,
    "scope" "CalendarScope" NOT NULL,
    "groupId" TEXT,
    "title" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,

    CONSTRAINT "CalendarDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyAttendance" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "DailyStatus" NOT NULL,
    "reasonId" TEXT,
    "note" TEXT,
    "documentProvided" BOOLEAN NOT NULL DEFAULT false,
    "markedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,

    CONSTRAINT "DailyAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AbsenceNotice" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "reasonId" TEXT NOT NULL,
    "comment" TEXT,
    "status" "NoticeStatus" NOT NULL DEFAULT 'pending',
    "createdById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AbsenceNotice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AbsenceReason_name_key" ON "AbsenceReason"("name");

-- CreateIndex
CREATE INDEX "CalendarDay_startDate_endDate_idx" ON "CalendarDay"("startDate", "endDate");

-- CreateIndex
CREATE INDEX "DailyAttendance_groupId_date_idx" ON "DailyAttendance"("groupId", "date");

-- CreateIndex
CREATE INDEX "DailyAttendance_childId_date_idx" ON "DailyAttendance"("childId", "date");

-- CreateIndex
CREATE INDEX "AbsenceNotice_childId_startDate_idx" ON "AbsenceNotice"("childId", "startDate");

-- AddForeignKey
ALTER TABLE "CalendarDay" ADD CONSTRAINT "CalendarDay_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarDay" ADD CONSTRAINT "CalendarDay_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarDay" ADD CONSTRAINT "CalendarDay_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyAttendance" ADD CONSTRAINT "DailyAttendance_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Child"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyAttendance" ADD CONSTRAINT "DailyAttendance_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyAttendance" ADD CONSTRAINT "DailyAttendance_reasonId_fkey" FOREIGN KEY ("reasonId") REFERENCES "AbsenceReason"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyAttendance" ADD CONSTRAINT "DailyAttendance_markedById_fkey" FOREIGN KEY ("markedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyAttendance" ADD CONSTRAINT "DailyAttendance_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbsenceNotice" ADD CONSTRAINT "AbsenceNotice_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Child"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbsenceNotice" ADD CONSTRAINT "AbsenceNotice_reasonId_fkey" FOREIGN KEY ("reasonId") REFERENCES "AbsenceReason"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbsenceNotice" ADD CONSTRAINT "AbsenceNotice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbsenceNotice" ADD CONSTRAINT "AbsenceNotice_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "AbsenceReason" ("id", "name", "excused", "requiresDocument", "active", "sortOrder") VALUES
  (gen_random_uuid()::text, 'Хвороба', true, true, true, 1),
  (gen_random_uuid()::text, 'Сімейні обставини', true, false, true, 2),
  (gen_random_uuid()::text, 'Відпустка', true, false, true, 3),
  (gen_random_uuid()::text, 'Без причини', false, false, true, 4);
