import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PermissionArea, PermissionLevel } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Permission } from '../common/decorators/permission.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { CreatePositionDto } from './dto/create-position.dto';
import { UpdatePositionDto } from './dto/update-position.dto';
import { PositionsService } from './positions.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Permission(PermissionArea.users, PermissionLevel.view)
@Controller('positions')
export class PositionsController {
  constructor(private positions: PositionsService) {}

  @Get()
  list() {
    return this.positions.list();
  }

  @Permission(PermissionArea.users, PermissionLevel.edit)
  @Post()
  create(
    @Body() dto: CreatePositionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.positions.create(dto, user);
  }

  @Permission(PermissionArea.users, PermissionLevel.edit)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePositionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.positions.update(id, dto, user);
  }

  @Permission(PermissionArea.users, PermissionLevel.edit)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.positions.remove(id, user);
  }
}
