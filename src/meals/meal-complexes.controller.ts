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
import { Roles } from '../common/decorators/roles.decorator';
import { MealComplexesService } from './meal-complexes.service';
import {
  AddComplexPriceDto,
  CreateMealComplexDto,
  UpdateMealComplexDto,
} from './dto/meal-complex.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.root, Role.admin)
@Controller('meal-complexes')
export class MealComplexesController {
  constructor(private complexes: MealComplexesService) {}

  @Get()
  list() {
    return this.complexes.list();
  }

  @Post()
  create(@Body() dto: CreateMealComplexDto) {
    return this.complexes.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateMealComplexDto) {
    return this.complexes.update(id, dto);
  }

  @Post(':id/prices')
  addPrice(@Param('id') id: string, @Body() dto: AddComplexPriceDto) {
    return this.complexes.addPrice(id, dto);
  }

  @Delete(':id/prices/:priceId')
  deletePrice(@Param('id') id: string, @Param('priceId') priceId: string) {
    return this.complexes.deletePrice(id, priceId);
  }
}
