import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { ParentRoutineController } from './parent-routine.controller';
import { RoutineController } from './routine.controller';
import { RoutineService } from './routine.service';

@Module({
  imports: [AttendanceModule],
  controllers: [RoutineController, ParentRoutineController],
  providers: [RoutineService],
})
export class RoutineModule {}
