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
import { Permission } from '../common/decorators/permission.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { SubscriptionTypesService } from './subscription-types.service';
import { CreateSubscriptionTypeDto } from './dto/create-subscription-type.dto';
import { UpdateSubscriptionTypeDto } from './dto/update-subscription-type.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('subscription-types')
export class SubscriptionTypesController {
  constructor(private service: SubscriptionTypesService) {}

  @Permission(PermissionArea.classes, PermissionLevel.edit)
  @Post()
  create(@Body() dto: CreateSubscriptionTypeDto) {
    return this.service.create(dto);
  }

  @Roles(Role.teacher)
  @Permission(PermissionArea.classes, PermissionLevel.view)
  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Roles(Role.teacher)
  @Permission(PermissionArea.classes, PermissionLevel.view)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Permission(PermissionArea.classes, PermissionLevel.edit)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSubscriptionTypeDto) {
    return this.service.update(id, dto);
  }

  @Permission(PermissionArea.classes, PermissionLevel.edit)
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.service.delete(id);
  }
}
