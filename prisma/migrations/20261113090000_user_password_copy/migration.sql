
-- CreateTable
CREATE TABLE "UserPasswordCopy" (
    "userId" TEXT NOT NULL,
    "sealed" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPasswordCopy_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "UserPasswordCopy" ADD CONSTRAINT "UserPasswordCopy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
