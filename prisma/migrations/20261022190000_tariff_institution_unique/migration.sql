-- DropIndex
DROP INDEX "Tariff_name_key";

-- CreateIndex
CREATE UNIQUE INDEX "Tariff_institutionId_name_key" ON "Tariff"("institutionId", "name");
