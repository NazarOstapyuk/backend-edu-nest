import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { TimetablesService } from './timetables.service';
import { CreateTimetableDto, TimetableEntriesDto } from './dto/timetable.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.root, Role.admin)
@Controller()
export class TimetablesController {
  constructor(private timetables: TimetablesService) {}

  @Get('groups/:id/timetables')
  list(@Param('id') id: string) {
    return this.timetables.list(id);
  }

  @Post('groups/:id/timetables')
  create(
    @Param('id') id: string,
    @Body() dto: CreateTimetableDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.timetables.create(id, dto, user);
  }

  @Put('timetables/:id/entries')
  replace(@Param('id') id: string, @Body() dto: TimetableEntriesDto) {
    return this.timetables.replaceEntries(id, dto);
  }

  @Get('groups/:id/schedule')
  @Roles(Role.root, Role.admin, Role.teacher)
  view(
    @Param('id') id: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.timetables.view(id, from, to, user);
  }
}
