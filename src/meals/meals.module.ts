import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { MealComplexesController } from './meal-complexes.controller';
import { MealComplexesService } from './meal-complexes.service';
import { MealDirectoriesController } from './meal-directories.controller';
import { MealDirectoriesService } from './meal-directories.service';
import { MealSettingsService } from './meal-settings.service';
import { MenuTemplatesController } from './menu-templates.controller';
import { MenuTemplatesService } from './menu-templates.service';
import { MenusController } from './menus.controller';
import { MenusService } from './menus.service';

@Module({
  imports: [AttendanceModule],
  controllers: [
    MealDirectoriesController,
    MealComplexesController,
    MenusController,
    MenuTemplatesController,
  ],
  providers: [
    MealDirectoriesService,
    MealComplexesService,
    MealSettingsService,
    MenusService,
    MenuTemplatesService,
  ],
})
export class MealsModule {}
