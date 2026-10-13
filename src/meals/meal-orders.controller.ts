import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { MealOrdersService } from './meal-orders.service';
import { AdminMealOrdersDto, CancelMealOrderDto } from './dto/meal-order.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.root, Role.admin)
@Controller('meal-orders')
export class MealOrdersController {
  constructor(private orders: MealOrdersService) {}

  @Post()
  create(
    @Body() dto: AdminMealOrdersDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.create(dto.childId, dto.days, user);
  }

  @Post(':id/cancel')
  cancel(
    @Param('id') id: string,
    @Body() dto: CancelMealOrderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.cancel(id, user, dto.reason);
  }
}
