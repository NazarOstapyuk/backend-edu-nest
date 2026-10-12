import { Module } from '@nestjs/common';
import { ParentCabinetController } from './parent-cabinet.controller';
import { ParentCabinetService } from './parent-cabinet.service';

@Module({
  controllers: [ParentCabinetController],
  providers: [ParentCabinetService],
})
export class ParentCabinetModule {}
