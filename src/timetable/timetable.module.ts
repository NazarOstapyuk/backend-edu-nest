import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { BellSchedulesController } from './bell-schedules.controller';
import { BellSchedulesService } from './bell-schedules.service';
import { DirectoriesController } from './directories.controller';
import { DirectoriesService } from './directories.service';
import { LessonChangesController } from './lesson-changes.controller';
import { LessonChangesService } from './lesson-changes.service';
import { LessonsController } from './lessons.controller';
import { LessonsService } from './lessons.service';
import { ScheduleService } from './schedule.service';
import { SubgroupsController } from './subgroups.controller';
import { SubgroupsService } from './subgroups.service';
import { TimetablesController } from './timetables.controller';
import { TimetablesService } from './timetables.service';

@Module({
  imports: [AttendanceModule],
  controllers: [
    DirectoriesController,
    BellSchedulesController,
    SubgroupsController,
    TimetablesController,
    LessonChangesController,
    LessonsController,
  ],
  providers: [
    DirectoriesService,
    BellSchedulesService,
    SubgroupsService,
    ScheduleService,
    TimetablesService,
    LessonChangesService,
    LessonsService,
  ],
})
export class TimetableModule {}
