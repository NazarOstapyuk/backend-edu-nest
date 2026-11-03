import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { PermissionArea, PermissionLevel, Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permission } from '../common/decorators/permission.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { DailyNotesService } from './daily-notes.service';
import { SaveNotesDto } from './dto/save-notes.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.teacher)
@Permission(PermissionArea.register, PermissionLevel.view)
@Controller()
export class DailyNotesController {
  constructor(private notes: DailyNotesService) {}

  @Get('daily-notes/groups')
  groups(@CurrentUser() user: AuthenticatedUser) {
    return this.notes.groups(user);
  }

  @Get('daily-notes/pending')
  pending(@CurrentUser() user: AuthenticatedUser) {
    return this.notes.pending(user);
  }

  @Get('groups/:groupId/notes/:date')
  day(
    @Param('groupId') groupId: string,
    @Param('date') date: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notes.day(groupId, date, user);
  }

  @Permission(PermissionArea.register, PermissionLevel.edit)
  @Put('groups/:groupId/notes/:date')
  save(
    @Param('groupId') groupId: string,
    @Param('date') date: string,
    @Body() dto: SaveNotesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notes.save(groupId, date, dto, user);
  }
}
