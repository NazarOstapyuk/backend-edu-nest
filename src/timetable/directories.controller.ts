import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PermissionArea, PermissionLevel, Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permission } from '../common/decorators/permission.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { DirectoriesService } from './directories.service';
import { CreateNamedDto, UpdateNamedDto } from './dto/named.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Permission(PermissionArea.timetable, PermissionLevel.edit)
@Controller()
export class DirectoriesController {
  constructor(private directories: DirectoriesService) {}

  @Roles(Role.teacher)
  @Permission(PermissionArea.timetable, PermissionLevel.view)
  @Get('subjects')
  subjects(@CurrentUser() user: AuthenticatedUser) {
    return this.directories.listSubjects(user);
  }

  @Post('subjects')
  createSubject(@Body() dto: CreateNamedDto) {
    return this.directories.createSubject(dto);
  }

  @Patch('subjects/:id')
  updateSubject(@Param('id') id: string, @Body() dto: UpdateNamedDto) {
    return this.directories.updateSubject(id, dto);
  }

  @Roles(Role.teacher)
  @Permission(PermissionArea.timetable, PermissionLevel.view)
  @Get('rooms')
  rooms(@CurrentUser() user: AuthenticatedUser) {
    return this.directories.listRooms(user);
  }

  @Post('rooms')
  createRoom(@Body() dto: CreateNamedDto) {
    return this.directories.createRoom(dto);
  }

  @Patch('rooms/:id')
  updateRoom(@Param('id') id: string, @Body() dto: UpdateNamedDto) {
    return this.directories.updateRoom(id, dto);
  }
}
