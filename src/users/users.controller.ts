// src/users/users.controller.ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PermissionArea, PermissionLevel } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import {
  Permission,
  PermissionAny,
} from '../common/decorators/permission.decorator';
import { CreateUserDto } from './dto/create-user.dto';
import { LookupUsersQueryDto } from './dto/lookup-users-query.dto';
import { UpdateAccessDto } from './dto/update-access.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Permission(PermissionArea.users, PermissionLevel.view)
@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Post()
  @Permission(PermissionArea.users, PermissionLevel.edit)
  create(@Body() dto: CreateUserDto, @CurrentUser() user: AuthenticatedUser) {
    return this.usersService.create(dto, user);
  }

  @Get('lookup')
  @PermissionAny(
    [
      PermissionArea.users,
      PermissionArea.children,
      PermissionArea.classes,
      PermissionArea.timetable,
      PermissionArea.payroll,
      PermissionArea.finance,
      PermissionArea.register,
    ],
    PermissionLevel.view,
  )
  lookup(
    @Query() query: LookupUsersQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.usersService.lookup(
      query.role,
      query.includeInactive === 'true',
      user,
    );
  }

  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @Delete(':id')
  @Permission(PermissionArea.users, PermissionLevel.edit)
  delete(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.usersService.delete(id, user);
  }

  @Patch(':id/access')
  @Permission(PermissionArea.users, PermissionLevel.edit)
  setAccess(
    @Param('id') id: string,
    @Body() dto: UpdateAccessDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.usersService.setAccess(id, dto, user);
  }

  @Patch(':id')
  @Permission(PermissionArea.users, PermissionLevel.edit)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.usersService.update(id, dto, user);
  }
}
