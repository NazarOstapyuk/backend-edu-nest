DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Group" WHERE "institutionId" IS NULL) THEN
    RAISE EXCEPTION 'Group.institutionId has NULL values';
  END IF;
END $$;

-- DropIndex
DROP INDEX "Group_name_key";

-- AlterTable
ALTER TABLE "Group" ALTER COLUMN "institutionId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Group_institutionId_name_key" ON "Group"("institutionId", "name");

