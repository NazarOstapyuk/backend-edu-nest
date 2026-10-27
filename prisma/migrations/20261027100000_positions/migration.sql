-- AlterTable
ALTER TABLE "User" ADD COLUMN     "positionId" TEXT;

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "teaching" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PositionPermission" (
    "id" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "area" "PermissionArea" NOT NULL,
    "level" "PermissionLevel" NOT NULL,

    CONSTRAINT "PositionPermission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Position_name_key" ON "Position"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PositionPermission_positionId_area_key" ON "PositionPermission"("positionId", "area");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionPermission" ADD CONSTRAINT "PositionPermission_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Data: one position per distinct (role, permission set) of staff
CREATE TEMP TABLE "_staff_perms" AS
SELECT u."id" AS "userId", u."role"::text AS "role", u."createdAt" AS "createdAt",
  COALESCE(string_agg(p."area"::text || ':' || p."level"::text, ',' ORDER BY p."area"::text), '') AS "perms",
  COUNT(p."id") AS "cnt",
  COUNT(p."id") FILTER (WHERE p."level" = 'edit') AS "editCnt"
FROM "User" u
LEFT JOIN "UserPermission" p ON p."userId" = u."id"
WHERE u."role" IN ('admin', 'teacher')
GROUP BY u."id", u."role", u."createdAt";

CREATE TEMP TABLE "_position_groups" AS
SELECT g."role", g."perms", g."first", g."special",
  CASE
    WHEN g."special" IS NOT NULL THEN g."special"
    WHEN g."role" = 'teacher' THEN 'Педагогічна посада ' || row_number() OVER (PARTITION BY g."role", (g."special" IS NULL) ORDER BY g."first", g."perms")
    ELSE 'Посада ' || row_number() OVER (PARTITION BY g."role", (g."special" IS NULL) ORDER BY g."first", g."perms")
  END AS "name",
  gen_random_uuid()::text AS "id"
FROM (
  SELECT "role", "perms", MIN("createdAt") AS "first",
    CASE
      WHEN "role" = 'teacher' AND "perms" = '' THEN 'Педагог'
      WHEN "role" = 'admin' AND MAX("cnt") = 12 AND MAX("editCnt") = 12 THEN 'Адміністратор'
      ELSE NULL
    END AS "special"
  FROM "_staff_perms"
  GROUP BY "role", "perms"
) g;

INSERT INTO "Position" ("id", "name", "teaching", "updatedAt")
SELECT "id", "name", "role" = 'teacher', now() FROM "_position_groups";

INSERT INTO "PositionPermission" ("id", "positionId", "area", "level")
SELECT gen_random_uuid()::text, g."id", p."area", p."level"
FROM "_position_groups" g
JOIN LATERAL (
  SELECT sp."userId" FROM "_staff_perms" sp
  WHERE sp."role" = g."role" AND sp."perms" = g."perms"
  ORDER BY sp."createdAt", sp."userId" LIMIT 1
) rep ON true
JOIN "UserPermission" p ON p."userId" = rep."userId";

UPDATE "User" u SET "positionId" = g."id"
FROM "_staff_perms" sp
JOIN "_position_groups" g ON g."role" = sp."role" AND g."perms" = sp."perms"
WHERE u."id" = sp."userId";

DROP TABLE "_position_groups";
DROP TABLE "_staff_perms";
