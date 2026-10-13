import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { ParentTimetableService } from './parent-timetable.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.parent)
@Controller('me/children')
export class ParentTimetableController {
  constructor(private parent: ParentTimetableService) {}

  @Get(':id/schedule')
  schedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.parent.schedule(user.id, id, from, to);
  }

  @Get(':id/lessons')
  lessons(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query('month') month: string,
  ) {
    return this.parent.lessons(user.id, id, month);
  }
}
