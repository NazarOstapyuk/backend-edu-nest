import { Module } from '@nestjs/common';
import { AbsenceReasonsController } from './absence-reasons.controller';
import { AbsenceReasonsService } from './absence-reasons.service';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { RegisterController } from './register.controller';
import { RegisterService } from './register.service';

@Module({
  controllers: [
    AbsenceReasonsController,
    CalendarController,
    RegisterController,
  ],
  providers: [AbsenceReasonsService, CalendarService, RegisterService],
  exports: [CalendarService, RegisterService],
})
export class AttendanceModule {}
