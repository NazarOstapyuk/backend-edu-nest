import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
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
import { RegisterService } from './register.service';
import { SaveRegisterDto } from './dto/save-register.dto';
import { UpdateRegisterSettingsDto } from './dto/update-register-settings.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.teacher)
@Permission(PermissionArea.register, PermissionLevel.view)
@Controller()
export class RegisterController {
  constructor(private register: RegisterService) {}

  @Get('register/groups')
  groups(@CurrentUser() user: AuthenticatedUser) {
    return this.register.groupsFor(user);
  }

  @Get('register/settings')
  async settings() {
    return { editDays: await this.register.getEditDays() };
  }

  @Roles()
  @Permission(PermissionArea.settings, PermissionLevel.edit)
  @Patch('register/settings')
  updateSettings(@Body() dto: UpdateRegisterSettingsDto) {
    return this.register.setEditDays(dto.editDays);
  }

  @Get('groups/:id/register')
  day(
    @Param('id') id: string,
    @Query('date') date: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.register.day(id, date, user);
  }

  @Permission(PermissionArea.register, PermissionLevel.edit)
  @Put('groups/:id/register')
  save(
    @Param('id') id: string,
    @Body() dto: SaveRegisterDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.register.save(id, dto, user);
  }

  @Get('groups/:id/register/month')
  month(
    @Param('id') id: string,
    @Query('month') month: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.register.month(id, month, user);
  }
}
