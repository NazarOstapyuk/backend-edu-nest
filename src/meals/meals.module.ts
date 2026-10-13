import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { MealComplexesController } from './meal-complexes.controller';
import { MealComplexesService } from './meal-complexes.service';
import { MealDirectoriesController } from './meal-directories.controller';
import { MealDirectoriesService } from './meal-directories.service';
import { MealOrdersController } from './meal-orders.controller';
import { MealOrdersService } from './meal-orders.service';
import { MealSettingsService } from './meal-settings.service';
import { MealViewsService } from './meal-views.service';
import { MenuTemplatesController } from './menu-templates.controller';
import { MenuTemplatesService } from './menu-templates.service';
import { MenusController } from './menus.controller';
import { MenusService } from './menus.service';
import { ParentMealsController } from './parent-meals.controller';
import { ParentMealsService } from './parent-meals.service';

@Module({
  imports: [AttendanceModule],
  controllers: [
    MealDirectoriesController,
    MealComplexesController,
    MenusController,
    MenuTemplatesController,
    MealOrdersController,
    ParentMealsController,
  ],
  providers: [
    MealDirectoriesService,
    MealComplexesService,
    MealSettingsService,
    MenusService,
    MenuTemplatesService,
    MealOrdersService,
    MealViewsService,
    ParentMealsService,
  ],
})
export class MealsModule {}
