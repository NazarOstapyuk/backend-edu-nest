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
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { GroupsService } from './groups.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Permission(PermissionArea.children, PermissionLevel.view)
@Controller('groups')
export class GroupsController {
  constructor(private groupsService: GroupsService) {}

  @Permission(PermissionArea.children, PermissionLevel.edit)
  @Post()
  create(@Body() dto: CreateGroupDto) {
    return this.groupsService.create(dto);
  }

  @Get()
  findAll() {
    return this.groupsService.findAll();
  }

  @Permission(PermissionArea.children, PermissionLevel.edit)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateGroupDto) {
    return this.groupsService.update(id, dto);
  }

  @Permission(PermissionArea.children, PermissionLevel.edit)
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.groupsService.delete(id);
  }
}
