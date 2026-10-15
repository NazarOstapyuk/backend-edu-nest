INSERT INTO "UserPermission" ("id", "userId", "area", "level")
SELECT gen_random_uuid()::text, u."id", 'audit'::"PermissionArea", 'edit'::"PermissionLevel"
FROM "User" u
WHERE u."role" = 'admin'
ON CONFLICT ("userId", "area") DO NOTHING;
