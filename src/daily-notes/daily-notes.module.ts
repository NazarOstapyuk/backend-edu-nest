import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { DailyNotesController } from './daily-notes.controller';
import { DailyNotesService } from './daily-notes.service';
import { NoteSetsController } from './note-sets.controller';
import { NoteSetsService } from './note-sets.service';
import { ParentNotesController } from './parent-notes.controller';

@Module({
  imports: [AttendanceModule],
  controllers: [
    NoteSetsController,
    DailyNotesController,
    ParentNotesController,
  ],
  providers: [NoteSetsService, DailyNotesService],
  exports: [DailyNotesService],
})
export class DailyNotesModule {}
