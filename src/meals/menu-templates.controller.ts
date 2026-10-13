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
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { MenuTemplatesService } from './menu-templates.service';
import {
  ApplyTemplateDto,
  CreateMenuTemplateDto,
  SaveTemplateItemsDto,
  UpdateMenuTemplateDto,
} from './dto/menu-template.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.root, Role.admin)
@Controller('menu-templates')
export class MenuTemplatesController {
  constructor(private templates: MenuTemplatesService) {}

  @Get()
  list() {
    return this.templates.list();
  }

  @Post()
  create(@Body() dto: CreateMenuTemplateDto) {
    return this.templates.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateMenuTemplateDto) {
    return this.templates.update(id, dto);
  }

  @Put(':id/items')
  saveItems(@Param('id') id: string, @Body() dto: SaveTemplateItemsDto) {
    return this.templates.saveItems(id, dto);
  }

  @Post(':id/apply')
  apply(@Param('id') id: string, @Body() dto: ApplyTemplateDto) {
    return this.templates.apply(id, dto);
  }
}
