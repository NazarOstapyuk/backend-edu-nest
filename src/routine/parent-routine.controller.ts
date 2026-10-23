import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { RoutineService } from './routine.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.parent)
@Controller('me/children')
export class ParentRoutineController {
  constructor(private routine: RoutineService) {}

  @Get(':id/routine')
  read(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.routine.parentRoutine(user.id, id, from, to);
  }
}
