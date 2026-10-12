import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { ReasonDto } from '../attendance/dto/reason.dto';
import { LessonChangesService } from './lesson-changes.service';
import { CreateLessonChangeDto } from './dto/lesson-change.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.root, Role.admin)
@Controller()
export class LessonChangesController {
  constructor(private changes: LessonChangesService) {}

  @Post('groups/:id/lesson-changes')
  create(
    @Param('id') id: string,
    @Body() dto: CreateLessonChangeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.changes.create(id, dto, user);
  }

  @Post('lesson-changes/:id/void')
  void(
    @Param('id') id: string,
    @Body() dto: ReasonDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.changes.void(id, dto.reason, user);
  }
}
