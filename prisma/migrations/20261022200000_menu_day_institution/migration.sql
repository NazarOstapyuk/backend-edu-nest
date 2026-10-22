DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "MenuDay" WHERE "institutionId" IS NULL) THEN
    RAISE EXCEPTION 'MenuDay rows without institution exist';
  END IF;
END $$;

-- DropIndex
DROP INDEX "MenuDay_date_kind_key";

-- AlterTable
ALTER TABLE "MenuDay" DROP COLUMN "kind",
ALTER COLUMN "institutionId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "MenuDay_date_institutionId_key" ON "MenuDay"("date", "institutionId");
