-- AlterTable
ALTER TABLE "Child" ADD COLUMN     "middleName" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "email" TEXT,
ADD COLUMN     "middleName" TEXT,
ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "phone" TEXT;

UPDATE "User" SET "mustChangePassword" = true WHERE "role" = 'parent';
