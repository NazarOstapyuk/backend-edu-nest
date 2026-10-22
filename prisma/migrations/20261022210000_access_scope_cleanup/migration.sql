-- AlterEnum
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "User" WHERE "accessScope"::text IN ('kindergarten', 'school_class')) THEN
    RAISE EXCEPTION 'Users with kind-based access scope still exist';
  END IF;
END $$;
CREATE TYPE "AccessScope_new" AS ENUM ('all', 'institutions');
ALTER TABLE "public"."User" ALTER COLUMN "accessScope" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "accessScope" TYPE "AccessScope_new" USING ("accessScope"::text::"AccessScope_new");
ALTER TYPE "AccessScope" RENAME TO "AccessScope_old";
ALTER TYPE "AccessScope_new" RENAME TO "AccessScope";
DROP TYPE "public"."AccessScope_old";
ALTER TABLE "User" ALTER COLUMN "accessScope" SET DEFAULT 'all';
COMMIT;
