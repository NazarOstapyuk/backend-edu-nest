import { Module } from '@nestjs/common';
import { AbsenceReasonsController } from './absence-reasons.controller';
import { AbsenceReasonsService } from './absence-reasons.service';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';

@Module({
  controllers: [AbsenceReasonsController, CalendarController],
  providers: [AbsenceReasonsService, CalendarService],
  exports: [CalendarService],
})
export class AttendanceModule {}
