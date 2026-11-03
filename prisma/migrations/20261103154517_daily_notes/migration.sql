-- CreateEnum
CREATE TYPE "NoteQuestionType" AS ENUM ('choice', 'text', 'yes_no', 'number');

-- CreateTable
CREATE TABLE "NoteSet" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "deadline" TEXT NOT NULL DEFAULT '17:00',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NoteSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoteQuestion" (
    "id" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "type" "NoteQuestionType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "options" TEXT[],
    "min" DECIMAL(10,2),
    "max" DECIMAL(10,2),
    "unit" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NoteQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoteAnswer" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "questionText" TEXT NOT NULL,
    "questionType" "NoteQuestionType" NOT NULL,
    "unit" TEXT,
    "valueText" TEXT,
    "valueBool" BOOLEAN,
    "valueNumber" DECIMAL(10,2),
    "answeredById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,

    CONSTRAINT "NoteAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_NoteSetGroups" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_NoteSetGroups_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "NoteSet_institutionId_name_key" ON "NoteSet"("institutionId", "name");

-- CreateIndex
CREATE INDEX "NoteQuestion_setId_idx" ON "NoteQuestion"("setId");

-- CreateIndex
CREATE INDEX "NoteAnswer_childId_date_idx" ON "NoteAnswer"("childId", "date");

-- CreateIndex
CREATE INDEX "NoteAnswer_groupId_date_idx" ON "NoteAnswer"("groupId", "date");

-- CreateIndex
CREATE INDEX "_NoteSetGroups_B_index" ON "_NoteSetGroups"("B");

-- AddForeignKey
ALTER TABLE "NoteSet" ADD CONSTRAINT "NoteSet_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteQuestion" ADD CONSTRAINT "NoteQuestion_setId_fkey" FOREIGN KEY ("setId") REFERENCES "NoteSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteAnswer" ADD CONSTRAINT "NoteAnswer_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Child"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteAnswer" ADD CONSTRAINT "NoteAnswer_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteAnswer" ADD CONSTRAINT "NoteAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "NoteQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteAnswer" ADD CONSTRAINT "NoteAnswer_answeredById_fkey" FOREIGN KEY ("answeredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteAnswer" ADD CONSTRAINT "NoteAnswer_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_NoteSetGroups" ADD CONSTRAINT "_NoteSetGroups_A_fkey" FOREIGN KEY ("A") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_NoteSetGroups" ADD CONSTRAINT "_NoteSetGroups_B_fkey" FOREIGN KEY ("B") REFERENCES "NoteSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
