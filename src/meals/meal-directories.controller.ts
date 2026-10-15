import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PermissionArea, PermissionLevel } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Permission } from '../common/decorators/permission.decorator';
import { MealDirectoriesService } from './meal-directories.service';
import { MealSettingsService } from './meal-settings.service';
import {
  CreateDishDto,
  CreateSortedNamedDto,
  DishesQueryDto,
  UpdateDishDto,
  UpdateSortedNamedDto,
} from './dto/meal-directory.dto';
import { UpdateMealSettingsDto } from './dto/meal-settings.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Permission(PermissionArea.meals, PermissionLevel.view)
@Controller()
export class MealDirectoriesController {
  constructor(
    private directories: MealDirectoriesService,
    private settings: MealSettingsService,
  ) {}

  @Get('meal-courses')
  courses() {
    return this.directories.listCourses();
  }

  @Permission(PermissionArea.meals, PermissionLevel.edit)
  @Post('meal-courses')
  createCourse(@Body() dto: CreateSortedNamedDto) {
    return this.directories.createCourse(dto);
  }

  @Permission(PermissionArea.meals, PermissionLevel.edit)
  @Patch('meal-courses/:id')
  updateCourse(@Param('id') id: string, @Body() dto: UpdateSortedNamedDto) {
    return this.directories.updateCourse(id, dto);
  }

  @Get('dishes')
  dishes(@Query() query: DishesQueryDto) {
    return this.directories.listDishes(query);
  }

  @Permission(PermissionArea.meals, PermissionLevel.edit)
  @Post('dishes')
  createDish(@Body() dto: CreateDishDto) {
    return this.directories.createDish(dto);
  }

  @Permission(PermissionArea.meals, PermissionLevel.edit)
  @Patch('dishes/:id')
  updateDish(@Param('id') id: string, @Body() dto: UpdateDishDto) {
    return this.directories.updateDish(id, dto);
  }

  @Get('meal-price-categories')
  priceCategories() {
    return this.directories.listPriceCategories();
  }

  @Permission(PermissionArea.meals, PermissionLevel.edit)
  @Post('meal-price-categories')
  createPriceCategory(@Body() dto: CreateSortedNamedDto) {
    return this.directories.createPriceCategory(dto);
  }

  @Permission(PermissionArea.meals, PermissionLevel.edit)
  @Patch('meal-price-categories/:id')
  updatePriceCategory(
    @Param('id') id: string,
    @Body() dto: UpdateSortedNamedDto,
  ) {
    return this.directories.updatePriceCategory(id, dto);
  }

  @Get('meals/settings')
  async getSettings() {
    return { mealOrderDeadline: await this.settings.getDeadline() };
  }

  @Permission(PermissionArea.settings, PermissionLevel.edit)
  @Patch('meals/settings')
  updateSettings(@Body() dto: UpdateMealSettingsDto) {
    return this.settings.setDeadline(dto.mealOrderDeadline);
  }
}
