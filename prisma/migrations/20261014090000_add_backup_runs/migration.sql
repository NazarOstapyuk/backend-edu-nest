-- CreateEnum
CREATE TYPE "BackupKind" AS ENUM ('scheduled', 'manual', 'pre_restore');

-- CreateEnum
CREATE TYPE "BackupStatus" AS ENUM ('running', 'succeeded', 'failed');

-- CreateTable
CREATE TABLE "BackupRun" (
    "id" TEXT NOT NULL,
    "kind" "BackupKind" NOT NULL,
    "status" "BackupStatus" NOT NULL,
    "fileName" TEXT,
    "sizeBytes" BIGINT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdById" TEXT,

    CONSTRAINT "BackupRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BackupRun_startedAt_idx" ON "BackupRun"("startedAt");

-- AddForeignKey
ALTER TABLE "BackupRun" ADD CONSTRAINT "BackupRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

