import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { PermissionArea, PermissionLevel } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { Permission } from '../common/decorators/permission.decorator';
import { MenuTemplatesService } from './menu-templates.service';
import {
  ApplyTemplateDto,
  CreateMenuTemplateDto,
  SaveTemplateItemsDto,
  UpdateMenuTemplateDto,
} from './dto/menu-template.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Permission(PermissionArea.meals, PermissionLevel.view)
@Controller('menu-templates')
export class MenuTemplatesController {
  constructor(private templates: MenuTemplatesService) {}

  @Get()
  list() {
    return this.templates.list();
  }

  @Permission(PermissionArea.meals, PermissionLevel.edit)
  @Post()
  create(@Body() dto: CreateMenuTemplateDto) {
    return this.templates.create(dto);
  }

  @Permission(PermissionArea.meals, PermissionLevel.edit)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateMenuTemplateDto) {
    return this.templates.update(id, dto);
  }

  @Permission(PermissionArea.meals, PermissionLevel.edit)
  @Put(':id/items')
  saveItems(@Param('id') id: string, @Body() dto: SaveTemplateItemsDto) {
    return this.templates.saveItems(id, dto);
  }

  @Permission(PermissionArea.meals, PermissionLevel.edit)
  @Post(':id/apply')
  apply(
    @Param('id') id: string,
    @Body() dto: ApplyTemplateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.templates.apply(id, dto, user);
  }
}
