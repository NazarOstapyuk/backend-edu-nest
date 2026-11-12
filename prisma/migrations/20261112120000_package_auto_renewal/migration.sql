-- AlterTable
ALTER TABLE "Package" ADD COLUMN     "renewedByAttendanceId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Package_renewedByAttendanceId_key" ON "Package"("renewedByAttendanceId");

-- AddForeignKey
ALTER TABLE "Package" ADD CONSTRAINT "Package_renewedByAttendanceId_fkey" FOREIGN KEY ("renewedByAttendanceId") REFERENCES "LessonAttendance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

