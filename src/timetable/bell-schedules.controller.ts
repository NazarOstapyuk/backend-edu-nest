import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { BellSchedulesService } from './bell-schedules.service';
import {
  CreateBellScheduleDto,
  UpdateBellScheduleDto,
} from './dto/bell-schedule.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.root, Role.admin)
@Controller('bell-schedules')
export class BellSchedulesController {
  constructor(private schedules: BellSchedulesService) {}

  @Get()
  @Roles(Role.root, Role.admin, Role.teacher)
  list() {
    return this.schedules.list();
  }

  @Post()
  create(@Body() dto: CreateBellScheduleDto) {
    return this.schedules.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateBellScheduleDto) {
    return this.schedules.update(id, dto);
  }
}
