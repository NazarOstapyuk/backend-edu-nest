import { Module } from '@nestjs/common';
import { ClassGroupsController } from './class-groups.controller';
import { ClassGroupsService } from './class-groups.service';
import { DirectionsController } from './directions.controller';
import { DirectionsService } from './directions.service';
import { LegacyService } from './legacy.service';
import { LessonsService } from './lessons.service';
import { PackagesController } from './packages.controller';
import { PackagesService } from './packages.service';

@Module({
  controllers: [
    DirectionsController,
    ClassGroupsController,
    PackagesController,
  ],
  providers: [
    DirectionsService,
    ClassGroupsService,
    LessonsService,
    PackagesService,
    LegacyService,
  ],
})
export class ClassesModule {}
