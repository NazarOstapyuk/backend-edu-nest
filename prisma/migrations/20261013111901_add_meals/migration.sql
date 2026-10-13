-- CreateEnum
CREATE TYPE "MenuStatus" AS ENUM ('draft', 'published');

-- AlterTable
ALTER TABLE "Group" ADD COLUMN     "mealPriceCategoryId" TEXT;

-- CreateTable
CREATE TABLE "MealCourse" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "MealCourse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dish" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Dish_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MealPriceCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "MealPriceCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MealComplex" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "MealComplex_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MealComplexCourse" (
    "complexId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,

    CONSTRAINT "MealComplexCourse_pkey" PRIMARY KEY ("complexId","courseId")
);

-- CreateTable
CREATE TABLE "MealComplexPrice" (
    "id" TEXT NOT NULL,
    "complexId" TEXT NOT NULL,
    "priceCategoryId" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "validFrom" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MealComplexPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuDay" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" "GroupKind" NOT NULL,
    "status" "MenuStatus" NOT NULL DEFAULT 'draft',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuDayItem" (
    "menuDayId" TEXT NOT NULL,
    "dishId" TEXT NOT NULL,

    CONSTRAINT "MenuDayItem_pkey" PRIMARY KEY ("menuDayId","dishId")
);

-- CreateTable
CREATE TABLE "MenuTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "weeks" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "MenuTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuTemplateItem" (
    "templateId" TEXT NOT NULL,
    "week" INTEGER NOT NULL,
    "weekday" INTEGER NOT NULL,
    "dishId" TEXT NOT NULL,

    CONSTRAINT "MenuTemplateItem_pkey" PRIMARY KEY ("templateId","week","weekday","dishId")
);

-- CreateTable
CREATE TABLE "MealOrder" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "menuDayId" TEXT NOT NULL,
    "complexId" TEXT NOT NULL,
    "priceCategoryId" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "chargeId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,

    CONSTRAINT "MealOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MealOrderItem" (
    "orderId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "dishId" TEXT NOT NULL,

    CONSTRAINT "MealOrderItem_pkey" PRIMARY KEY ("orderId","courseId")
);

-- CreateIndex
CREATE UNIQUE INDEX "MealCourse_name_key" ON "MealCourse"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Dish_courseId_name_key" ON "Dish"("courseId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "MealPriceCategory_name_key" ON "MealPriceCategory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "MealComplex_name_key" ON "MealComplex"("name");

-- CreateIndex
CREATE UNIQUE INDEX "MealComplexPrice_complexId_priceCategoryId_validFrom_key" ON "MealComplexPrice"("complexId", "priceCategoryId", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "MenuDay_date_kind_key" ON "MenuDay"("date", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "MenuTemplate_name_key" ON "MenuTemplate"("name");

-- CreateIndex
CREATE UNIQUE INDEX "MealOrder_chargeId_key" ON "MealOrder"("chargeId");

-- CreateIndex
CREATE INDEX "MealOrder_date_childId_idx" ON "MealOrder"("date", "childId");

-- AddForeignKey
ALTER TABLE "Group" ADD CONSTRAINT "Group_mealPriceCategoryId_fkey" FOREIGN KEY ("mealPriceCategoryId") REFERENCES "MealPriceCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dish" ADD CONSTRAINT "Dish_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "MealCourse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealComplexCourse" ADD CONSTRAINT "MealComplexCourse_complexId_fkey" FOREIGN KEY ("complexId") REFERENCES "MealComplex"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealComplexCourse" ADD CONSTRAINT "MealComplexCourse_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "MealCourse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealComplexPrice" ADD CONSTRAINT "MealComplexPrice_complexId_fkey" FOREIGN KEY ("complexId") REFERENCES "MealComplex"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealComplexPrice" ADD CONSTRAINT "MealComplexPrice_priceCategoryId_fkey" FOREIGN KEY ("priceCategoryId") REFERENCES "MealPriceCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuDayItem" ADD CONSTRAINT "MenuDayItem_menuDayId_fkey" FOREIGN KEY ("menuDayId") REFERENCES "MenuDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuDayItem" ADD CONSTRAINT "MenuDayItem_dishId_fkey" FOREIGN KEY ("dishId") REFERENCES "Dish"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuTemplateItem" ADD CONSTRAINT "MenuTemplateItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MenuTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuTemplateItem" ADD CONSTRAINT "MenuTemplateItem_dishId_fkey" FOREIGN KEY ("dishId") REFERENCES "Dish"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealOrder" ADD CONSTRAINT "MealOrder_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Child"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealOrder" ADD CONSTRAINT "MealOrder_menuDayId_fkey" FOREIGN KEY ("menuDayId") REFERENCES "MenuDay"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealOrder" ADD CONSTRAINT "MealOrder_complexId_fkey" FOREIGN KEY ("complexId") REFERENCES "MealComplex"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealOrder" ADD CONSTRAINT "MealOrder_priceCategoryId_fkey" FOREIGN KEY ("priceCategoryId") REFERENCES "MealPriceCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealOrder" ADD CONSTRAINT "MealOrder_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "Charge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealOrder" ADD CONSTRAINT "MealOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealOrder" ADD CONSTRAINT "MealOrder_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealOrderItem" ADD CONSTRAINT "MealOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "MealOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealOrderItem" ADD CONSTRAINT "MealOrderItem_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "MealCourse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealOrderItem" ADD CONSTRAINT "MealOrderItem_dishId_fkey" FOREIGN KEY ("dishId") REFERENCES "Dish"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
