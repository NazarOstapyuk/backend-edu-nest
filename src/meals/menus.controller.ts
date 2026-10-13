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
import { GroupKind, Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { MenusService } from './menus.service';
import { CopyMenuDto, MenuPeriodDto, SaveMenuDayDto } from './dto/menu.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.root, Role.admin)
@Controller('menu-days')
export class MenusController {
  constructor(private menus: MenusService) {}

  @Get()
  list(@Query() query: MenuPeriodDto) {
    return this.menus.list(query);
  }

  @Post('publish')
  publish(@Body() dto: MenuPeriodDto) {
    return this.menus.publish(dto);
  }

  @Post('unpublish')
  unpublish(@Body() dto: MenuPeriodDto) {
    return this.menus.unpublish(dto);
  }

  @Post('copy')
  copy(@Body() dto: CopyMenuDto) {
    return this.menus.copy(dto);
  }

  @Put(':date/:kind')
  save(
    @Param('date') date: string,
    @Param('kind', new ParseEnumPipe(GroupKind)) kind: GroupKind,
    @Body() dto: SaveMenuDayDto,
  ) {
    return this.menus.saveDay(date, kind, dto);
  }

  @Delete(':date/:kind')
  remove(
    @Param('date') date: string,
    @Param('kind', new ParseEnumPipe(GroupKind)) kind: GroupKind,
  ) {
    return this.menus.deleteDay(date, kind);
  }
}
