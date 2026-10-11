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
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { AddTariffPriceDto } from './dto/add-tariff-price.dto';
import { CreateTariffDto } from './dto/create-tariff.dto';
import { UpdateTariffDto } from './dto/update-tariff.dto';
import { TariffsService } from './tariffs.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.root, Role.admin)
@Controller('tariffs')
export class TariffsController {
  constructor(private tariffs: TariffsService) {}

  @Get()
  list() {
    return this.tariffs.list();
  }

  @Post()
  create(@Body() dto: CreateTariffDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tariffs.create(dto, user.id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTariffDto) {
    return this.tariffs.update(id, dto);
  }

  @Post(':id/prices')
  addPrice(
    @Param('id') id: string,
    @Body() dto: AddTariffPriceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tariffs.addPrice(id, dto, user.id);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.tariffs.delete(id);
  }
}
