import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { ClassGroupsService } from './class-groups.service';
import { AddMemberDto } from './dto/add-member.dto';
import { CreateClassGroupDto } from './dto/create-class-group.dto';
import { EndMemberDto } from './dto/end-member.dto';
import { MarkLessonDto } from './dto/mark-lesson.dto';
import { UpdateClassGroupDto } from './dto/update-class-group.dto';
import { LessonsService } from './lessons.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.root, Role.admin, Role.teacher)
@Controller()
export class ClassGroupsController {
  constructor(
    private groups: ClassGroupsService,
    private lessons: LessonsService,
  ) {}

  @Roles(Role.root, Role.admin)
  @Post('class-groups')
  create(@Body() dto: CreateClassGroupDto) {
    return this.groups.create(dto);
  }

  @Roles(Role.root, Role.admin)
  @Patch('class-groups/:id')
  update(@Param('id') id: string, @Body() dto: UpdateClassGroupDto) {
    return this.groups.update(id, dto);
  }

  @Roles(Role.root, Role.admin)
  @Delete('class-groups/:id')
  delete(@Param('id') id: string) {
    return this.groups.delete(id);
  }

  @Get('class-groups/:id')
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.groups.get(id, user);
  }

  @Get('my/class-groups')
  my(@CurrentUser() user: AuthenticatedUser) {
    return this.groups.myGroups(user);
  }

  @Roles(Role.root, Role.admin)
  @Post('class-groups/:id/members')
  addMember(
    @Param('id') id: string,
    @Body() dto: AddMemberDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.groups.addMember(id, dto, user.id);
  }

  @Roles(Role.root, Role.admin)
  @Patch('class-group-members/:id/end')
  endMember(@Param('id') id: string, @Body() dto: EndMemberDto) {
    return this.groups.endMember(id, dto);
  }

  @Get('class-groups/:id/lessons/:date')
  roster(
    @Param('id') id: string,
    @Param('date') date: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.lessons.getRoster(id, date, user);
  }

  @Put('class-groups/:id/lessons/:date')
  async mark(
    @Param('id') id: string,
    @Param('date') date: string,
    @Body() dto: MarkLessonDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.lessons.mark(id, date, dto, user);
    return this.lessons.getRoster(id, date, user);
  }
}
