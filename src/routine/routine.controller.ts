import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PermissionArea, PermissionLevel, Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permission } from '../common/decorators/permission.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import {
  CopyRoutineDto,
  CreateRoutineTemplateDto,
  SaveRoutineDayDto,
  UpdateRoutineTemplateDto,
} from './dto/routine.dto';
import { RoutineService } from './routine.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Permission(PermissionArea.timetable, PermissionLevel.edit)
@Controller()
export class RoutineController {
  constructor(private routine: RoutineService) {}

  @Roles(Role.teacher)
  @Permission(PermissionArea.timetable, PermissionLevel.view)
  @Get('groups/:id/routine')
  read(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.routine.routine(user, id, from, to);
  }

  @Roles(Role.teacher)
  @Permission(PermissionArea.timetable, PermissionLevel.view)
  @Get('groups/:id/routine/templates')
  templates(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.routine.templates(user, id);
  }

  @Post('groups/:id/routine/templates')
  createTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateRoutineTemplateDto,
  ) {
    return this.routine.createTemplate(user, id, dto);
  }

  @Put('routine-templates/:id')
  updateTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateRoutineTemplateDto,
  ) {
    return this.routine.updateTemplate(user, id, dto);
  }

  @Delete('routine-templates/:id')
  deleteTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.routine.deleteTemplate(user, id);
  }

  @Put('groups/:id/routine/days/:date')
  saveDay(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('date') date: string,
    @Body() dto: SaveRoutineDayDto,
  ) {
    return this.routine.saveDay(user, id, date, dto);
  }

  @Delete('groups/:id/routine/days/:date')
  deleteDay(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('date') date: string,
  ) {
    return this.routine.deleteDay(user, id, date);
  }

  @Post('groups/:id/routine/copy')
  copy(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CopyRoutineDto,
  ) {
    return this.routine.copy(user, id, dto);
  }
}
