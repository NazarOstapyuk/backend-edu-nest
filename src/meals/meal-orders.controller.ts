import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PermissionArea, PermissionLevel, Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permission } from '../common/decorators/permission.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { MealOrdersService } from './meal-orders.service';
import { MealViewsService } from './meal-views.service';
import { AdminMealOrdersDto, CancelMealOrderDto } from './dto/meal-order.dto';
import { MealOrdersQueryDto, TodayOrdersQueryDto } from './dto/meal-views.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Permission(PermissionArea.meals, PermissionLevel.view)
@Controller('meal-orders')
export class MealOrdersController {
  constructor(
    private orders: MealOrdersService,
    private views: MealViewsService,
  ) {}

  @Get()
  list(
    @Query() query: MealOrdersQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.views.adminList(query, user);
  }

  @Roles(Role.teacher)
  @Permission(PermissionArea.meals, PermissionLevel.view)
  @Get('today')
  today(
    @Query() query: TodayOrdersQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.views.today(query.groupId, user);
  }

  @Permission(PermissionArea.meals, PermissionLevel.edit)
  @Post()
  create(
    @Body() dto: AdminMealOrdersDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.create(dto.childId, dto.days, user);
  }

  @Permission(PermissionArea.meals, PermissionLevel.edit)
  @Post(':id/cancel')
  cancel(
    @Param('id') id: string,
    @Body() dto: CancelMealOrderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.cancel(id, user, dto.reason);
  }
}
