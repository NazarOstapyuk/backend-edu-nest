import { Module } from '@nestjs/common';
import { AbsenceNoticesController } from './absence-notices.controller';
import { AbsenceReasonsController } from './absence-reasons.controller';
import { AbsenceReasonsService } from './absence-reasons.service';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { NoticesService } from './notices.service';
import { ParentAttendanceController } from './parent-attendance.controller';
import { ParentAttendanceService } from './parent-attendance.service';
import { RegisterController } from './register.controller';
import { RegisterService } from './register.service';

@Module({
  controllers: [
    AbsenceReasonsController,
    AbsenceNoticesController,
    CalendarController,
    ParentAttendanceController,
    RegisterController,
  ],
  providers: [
    AbsenceReasonsService,
    CalendarService,
    NoticesService,
    ParentAttendanceService,
    RegisterService,
  ],
  exports: [CalendarService, RegisterService],
})
export class AttendanceModule {}
