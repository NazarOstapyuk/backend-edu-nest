import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { SubscriptionTypesService } from './subscription-types.service';
import { CreateSubscriptionTypeDto } from './dto/create-subscription-type.dto';
import { UpdateSubscriptionTypeDto } from './dto/update-subscription-type.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('subscription-types')
export class SubscriptionTypesController {
  constructor(private service: SubscriptionTypesService) {}

  @Roles(Role.root, Role.admin)
  @Post()
  create(@Body() dto: CreateSubscriptionTypeDto) {
    return this.service.create(dto);
  }

  @Roles(Role.root, Role.admin, Role.teacher)
  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Roles(Role.root, Role.admin, Role.teacher)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Roles(Role.root, Role.admin)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSubscriptionTypeDto) {
    return this.service.update(id, dto);
  }

  @Roles(Role.root, Role.admin)
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.service.delete(id);
  }
}
