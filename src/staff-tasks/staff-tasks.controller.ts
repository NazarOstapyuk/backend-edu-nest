import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { CreateStaffTaskDto } from './dto/create-staff-task.dto';
import { ListStaffTasksDto } from './dto/list-staff-tasks.dto';
import { UpdateStaffTaskDto } from './dto/update-staff-task.dto';
import { StaffTasksService } from './staff-tasks.service';

@UseGuards(JwtAuthGuard)
@Controller('staff-tasks')
export class StaffTasksController {
  constructor(private tasks: StaffTasksService) {}

  @Get('assignable')
  assignable(@CurrentUser() user: AuthenticatedUser) {
    return this.tasks.assignable(user);
  }

  @Get('given')
  given(
    @Query() query: ListStaffTasksDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasks.given(query, user);
  }

  @Get('mine')
  mine(
    @Query() query: ListStaffTasksDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasks.mine(query, user);
  }

  @Get('summary')
  summary(@CurrentUser() user: AuthenticatedUser) {
    return this.tasks.summary(user);
  }

  @Post()
  create(
    @Body() dto: CreateStaffTaskDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasks.create(dto, user);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateStaffTaskDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasks.update(id, dto, user);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tasks.cancel(id, user);
  }

  @Post(':id/done')
  done(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tasks.done(id, user);
  }

  @Post(':id/undone')
  undone(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tasks.undone(id, user);
  }
}
