import { Module } from '@nestjs/common';
import { StaffTasksController } from './staff-tasks.controller';
import { StaffTasksService } from './staff-tasks.service';

@Module({
  controllers: [StaffTasksController],
  providers: [StaffTasksService],
  exports: [StaffTasksService],
})
export class StaffTasksModule {}
