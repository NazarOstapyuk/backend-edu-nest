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
import { AddTariffPriceDto } from './dto/add-tariff-price.dto';
import { CreateTariffDto } from './dto/create-tariff.dto';
import { UpdateTariffDto } from './dto/update-tariff.dto';
import { TariffsService } from './tariffs.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Permission(PermissionArea.tariffs, PermissionLevel.view)
@Controller('tariffs')
export class TariffsController {
  constructor(private tariffs: TariffsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.tariffs.list(user);
  }

  @Permission(PermissionArea.tariffs, PermissionLevel.edit)
  @Post()
  create(@Body() dto: CreateTariffDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tariffs.create(dto, user);
  }

  @Permission(PermissionArea.tariffs, PermissionLevel.edit)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTariffDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tariffs.update(id, dto, user);
  }

  @Permission(PermissionArea.tariffs, PermissionLevel.edit)
  @Post(':id/prices')
  addPrice(
    @Param('id') id: string,
    @Body() dto: AddTariffPriceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tariffs.addPrice(id, dto, user);
  }

  @Permission(PermissionArea.tariffs, PermissionLevel.edit)
  @Delete(':id')
  delete(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tariffs.delete(id, user);
  }
}
