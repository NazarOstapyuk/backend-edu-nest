import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseEnumPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { GroupKind, PermissionArea, PermissionLevel } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Permission } from '../common/decorators/permission.decorator';
import { MenusService } from './menus.service';
import { CopyMenuDto, MenuPeriodDto, SaveMenuDayDto } from './dto/menu.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Permission(PermissionArea.meals, PermissionLevel.view)
@Controller('menu-days')
export class MenusController {
  constructor(private menus: MenusService) {}

  @Get()
  list(@Query() query: MenuPeriodDto) {
    return this.menus.list(query);
  }

  @Permission(PermissionArea.meals, PermissionLevel.edit)
  @Post('publish')
  publish(@Body() dto: MenuPeriodDto) {
    return this.menus.publish(dto);
  }

  @Permission(PermissionArea.meals, PermissionLevel.edit)
  @Post('unpublish')
  unpublish(@Body() dto: MenuPeriodDto) {
    return this.menus.unpublish(dto);
  }

  @Permission(PermissionArea.meals, PermissionLevel.edit)
  @Post('copy')
  copy(@Body() dto: CopyMenuDto) {
    return this.menus.copy(dto);
  }

  @Permission(PermissionArea.meals, PermissionLevel.edit)
  @Put(':date/:kind')
  save(
    @Param('date') date: string,
    @Param('kind', new ParseEnumPipe(GroupKind)) kind: GroupKind,
    @Body() dto: SaveMenuDayDto,
  ) {
    return this.menus.saveDay(date, kind, dto);
  }

  @Permission(PermissionArea.meals, PermissionLevel.edit)
  @Delete(':date/:kind')
  remove(
    @Param('date') date: string,
    @Param('kind', new ParseEnumPipe(GroupKind)) kind: GroupKind,
  ) {
    return this.menus.deleteDay(date, kind);
  }
}
