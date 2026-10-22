INSERT INTO "UserInstitution" ("userId", "institutionId")
SELECT u."id", i."id"
FROM "User" u
JOIN "Institution" i ON i."type"::text = u."accessScope"::text
WHERE u."accessScope" IN ('kindergarten', 'school_class');

UPDATE "User" SET "accessScope" = 'institutions'
WHERE "accessScope" IN ('kindergarten', 'school_class');
