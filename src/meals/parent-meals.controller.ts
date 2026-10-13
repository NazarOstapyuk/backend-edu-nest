import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { ParentMealsService } from './parent-meals.service';
import { ParentMealOrdersDto } from './dto/meal-order.dto';
import { ParentMenuQueryDto } from './dto/meal-views.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.parent)
@Controller('me/children')
export class ParentMealsController {
  constructor(private meals: ParentMealsService) {}

  @Get(':id/menu')
  menu(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query() query: ParentMenuQueryDto,
  ) {
    return this.meals.menu(user.id, id, query.from, query.to);
  }

  @Post(':id/meal-orders')
  order(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ParentMealOrdersDto,
  ) {
    return this.meals.order(user, id, dto);
  }

  @Post(':id/meal-orders/:orderId/cancel')
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('orderId') orderId: string,
  ) {
    return this.meals.cancel(user, id, orderId);
  }
}
