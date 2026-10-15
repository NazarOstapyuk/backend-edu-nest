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
import { PermissionArea, PermissionLevel, Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permission } from '../common/decorators/permission.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { ChildrenService } from './children.service';
import { CreateChildDto } from './dto/create-child.dto';
import { UpdateChildDto } from './dto/update-child.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.teacher)
@Permission(PermissionArea.children, PermissionLevel.view)
@Controller('children')
export class ChildrenController {
  constructor(private childrenService: ChildrenService) {}

  @Permission(PermissionArea.children, PermissionLevel.edit)
  @Post()
  create(@Body() dto: CreateChildDto, @CurrentUser() user: AuthenticatedUser) {
    return this.childrenService.create(dto, user);
  }

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.childrenService.findAll(user);
  }

  @Permission(PermissionArea.children, PermissionLevel.edit)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateChildDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.childrenService.update(id, dto, user);
  }

  @Permission(PermissionArea.children, PermissionLevel.edit)
  @Delete(':id')
  delete(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.childrenService.delete(id, user);
  }
}
