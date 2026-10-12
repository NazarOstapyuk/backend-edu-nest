import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { BellSchedulesController } from './bell-schedules.controller';
import { BellSchedulesService } from './bell-schedules.service';
import { DirectoriesController } from './directories.controller';
import { DirectoriesService } from './directories.service';
import { SubgroupsController } from './subgroups.controller';
import { SubgroupsService } from './subgroups.service';

@Module({
  imports: [AttendanceModule],
  controllers: [
    DirectoriesController,
    BellSchedulesController,
    SubgroupsController,
  ],
  providers: [DirectoriesService, BellSchedulesService, SubgroupsService],
})
export class TimetableModule {}
