import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { CalendarService } from './calendar.service';
import { CreateCalendarDayDto } from './dto/create-calendar-day.dto';
import { ReasonDto } from './dto/reason.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.root, Role.admin)
@Controller('calendar')
export class CalendarController {
  constructor(private calendar: CalendarService) {}

  @Get()
  @Roles(Role.root, Role.admin, Role.teacher)
  list(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('groupId') groupId?: string,
  ) {
    return this.calendar.list(from, to, groupId);
  }

  @Post()
  create(
    @Body() dto: CreateCalendarDayDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.calendar.create(dto, user);
  }

  @Post(':id/void')
  void(
    @Param('id') id: string,
    @Body() dto: ReasonDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.calendar.void(id, dto.reason, user);
  }
}
