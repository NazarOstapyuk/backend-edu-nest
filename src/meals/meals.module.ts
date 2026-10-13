import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { MealComplexesController } from './meal-complexes.controller';
import { MealComplexesService } from './meal-complexes.service';
import { MealDirectoriesController } from './meal-directories.controller';
import { MealDirectoriesService } from './meal-directories.service';
import { MealSettingsService } from './meal-settings.service';

@Module({
  imports: [AttendanceModule],
  controllers: [MealDirectoriesController, MealComplexesController],
  providers: [
    MealDirectoriesService,
    MealComplexesService,
    MealSettingsService,
  ],
})
export class MealsModule {}
