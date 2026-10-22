-- CreateEnum
CREATE TYPE "InstitutionType" AS ENUM ('kindergarten', 'school_class');

-- AlterEnum
ALTER TYPE "AccessScope" ADD VALUE 'institutions';

-- AlterEnum
ALTER TYPE "CalendarScope" ADD VALUE 'institution';

-- AlterTable
ALTER TABLE "CalendarDay" ADD COLUMN     "institutionId" TEXT;

-- AlterTable
ALTER TABLE "Group" ADD COLUMN     "institutionId" TEXT;

-- AlterTable
ALTER TABLE "MenuDay" ADD COLUMN     "institutionId" TEXT;

-- AlterTable
ALTER TABLE "Tariff" ADD COLUMN     "institutionId" TEXT;

-- CreateTable
CREATE TABLE "Institution" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "InstitutionType" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Institution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserInstitution" (
    "userId" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,

    CONSTRAINT "UserInstitution_pkey" PRIMARY KEY ("userId","institutionId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Institution_name_key" ON "Institution"("name");

-- AddForeignKey
ALTER TABLE "Group" ADD CONSTRAINT "Group_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tariff" ADD CONSTRAINT "Tariff_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarDay" ADD CONSTRAINT "CalendarDay_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuDay" ADD CONSTRAINT "MenuDay_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserInstitution" ADD CONSTRAINT "UserInstitution_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserInstitution" ADD CONSTRAINT "UserInstitution_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill
INSERT INTO "Institution" ("id", "name", "type", "updatedAt") VALUES
  (gen_random_uuid(), 'Садок', 'kindergarten', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Школа', 'school_class', CURRENT_TIMESTAMP);

UPDATE "Group" g SET "institutionId" = i."id"
FROM "Institution" i WHERE i."type"::text = g."kind"::text;

UPDATE "MenuDay" m SET "institutionId" = i."id"
FROM "Institution" i WHERE i."type"::text = m."kind"::text;
