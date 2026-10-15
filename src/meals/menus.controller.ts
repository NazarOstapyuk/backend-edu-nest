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
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { Permission } from '../common/decorators/permission.decorator';
import { MenusService } from './menus.service';
import { CopyMenuDto, MenuPeriodDto, SaveMenuDayDto } from './dto/menu.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Permission(PermissionArea.meals, PermissionLevel.view)
@Controller('menu-days')
export class MenusController {
  constructor(private menus: MenusService) {}

  @Get()
  list(@Query() query: MenuPeriodDto, @CurrentUser() user: AuthenticatedUser) {
    return this.menus.list(query, user);
  }

  @Permission(PermissionArea.meals, PermissionLevel.edit)
  @Post('publish')
  publish(@Body() dto: MenuPeriodDto, @CurrentUser() user: AuthenticatedUser) {
    return this.menus.publish(dto, user);
  }

  @Permission(PermissionArea.meals, PermissionLevel.edit)
  @Post('unpublish')
  unpublish(
    @Body() dto: MenuPeriodDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.menus.unpublish(dto, user);
  }

  @Permission(PermissionArea.meals, PermissionLevel.edit)
  @Post('copy')
  copy(@Body() dto: CopyMenuDto, @CurrentUser() user: AuthenticatedUser) {
    return this.menus.copy(dto, user);
  }

  @Permission(PermissionArea.meals, PermissionLevel.edit)
  @Put(':date/:kind')
  save(
    @Param('date') date: string,
    @Param('kind', new ParseEnumPipe(GroupKind)) kind: GroupKind,
    @Body() dto: SaveMenuDayDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.menus.saveDay(date, kind, dto, user);
  }

  @Permission(PermissionArea.meals, PermissionLevel.edit)
  @Delete(':date/:kind')
  remove(
    @Param('date') date: string,
    @Param('kind', new ParseEnumPipe(GroupKind)) kind: GroupKind,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.menus.deleteDay(date, kind, user);
  }
}
