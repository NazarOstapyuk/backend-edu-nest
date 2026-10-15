import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PermissionArea, PermissionLevel } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Permission } from '../common/decorators/permission.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { NoticesService } from './notices.service';
import { ListNoticesQueryDto } from './dto/list-notices-query.dto';
import { ReasonDto } from './dto/reason.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Permission(PermissionArea.register, PermissionLevel.view)
@Controller('absence-notices')
export class AbsenceNoticesController {
  constructor(private notices: NoticesService) {}

  @Get()
  list(@Query() query: ListNoticesQueryDto) {
    return this.notices.list(query);
  }

  @Permission(PermissionArea.register, PermissionLevel.edit)
  @Post(':id/approve')
  approve(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.notices.approve(id, user);
  }

  @Permission(PermissionArea.register, PermissionLevel.edit)
  @Post(':id/reject')
  reject(
    @Param('id') id: string,
    @Body() dto: ReasonDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notices.reject(id, dto.reason, user);
  }

  @Permission(PermissionArea.register, PermissionLevel.edit)
  @Post(':id/cancel')
  cancel(
    @Param('id') id: string,
    @Body() dto: ReasonDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notices.cancel(id, dto.reason, user);
  }
}
