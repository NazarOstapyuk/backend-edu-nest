import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
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
import { LessonsService } from './lessons.service';
import { SaveLessonDto } from './dto/save-lesson.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.root, Role.admin, Role.teacher)
@Controller()
export class LessonsController {
  constructor(private lessons: LessonsService) {}

  @Get('me/lessons')
  my(
    @CurrentUser() user: AuthenticatedUser,
    @Query('date') date: string,
    @Query('teacherId') teacherId?: string,
  ) {
    return this.lessons.myLessons(user, date, teacherId);
  }

  @Get('groups/:id/lessons/:date/:period')
  view(
    @Param('id') id: string,
    @Param('date') date: string,
    @Param('period', ParseIntPipe) period: number,
    @CurrentUser() user: AuthenticatedUser,
    @Query('subgroupId') subgroupId?: string,
  ) {
    return this.lessons.view(id, date, period, subgroupId ?? null, user);
  }

  @Put('groups/:id/lessons/:date/:period')
  save(
    @Param('id') id: string,
    @Param('date') date: string,
    @Param('period', ParseIntPipe) period: number,
    @Body() dto: SaveLessonDto,
    @CurrentUser() user: AuthenticatedUser,
    @Query('subgroupId') subgroupId?: string,
  ) {
    return this.lessons.save(id, date, period, subgroupId ?? null, dto, user);
  }
}
