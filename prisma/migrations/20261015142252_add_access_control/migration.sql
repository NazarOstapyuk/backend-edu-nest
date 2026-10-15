-- CreateEnum
CREATE TYPE "PermissionArea" AS ENUM ('users', 'children', 'finance', 'tariffs', 'classes', 'register', 'timetable', 'meals', 'payroll', 'backups', 'settings');

-- CreateEnum
CREATE TYPE "PermissionLevel" AS ENUM ('view', 'edit');

-- CreateEnum
CREATE TYPE "AccessScope" AS ENUM ('all', 'kindergarten', 'school_class');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "accessScope" "AccessScope" NOT NULL DEFAULT 'all';

-- CreateTable
CREATE TABLE "UserPermission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "area" "PermissionArea" NOT NULL,
    "level" "PermissionLevel" NOT NULL,

    CONSTRAINT "UserPermission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserPermission_userId_area_key" ON "UserPermission"("userId", "area");

-- AddForeignKey
ALTER TABLE "UserPermission" ADD CONSTRAINT "UserPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


INSERT INTO "UserPermission" ("id", "userId", "area", "level")
SELECT gen_random_uuid()::text, u."id", a.area, 'edit'::"PermissionLevel"
FROM "User" u
CROSS JOIN unnest(enum_range(NULL::"PermissionArea")) AS a(area)
WHERE u."role" = 'admin';
