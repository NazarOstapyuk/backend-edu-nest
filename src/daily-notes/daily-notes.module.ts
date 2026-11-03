import { Module } from '@nestjs/common';
import { NoteSetsController } from './note-sets.controller';
import { NoteSetsService } from './note-sets.service';

@Module({
  controllers: [NoteSetsController],
  providers: [NoteSetsService],
})
export class DailyNotesModule {}
