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
import { NoticesService } from './notices.service';
import { ParentAttendanceService } from './parent-attendance.service';
import { CreateNoticeDto } from './dto/create-notice.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.parent)
@Controller('me/children')
export class ParentAttendanceController {
  constructor(
    private notices: NoticesService,
    private attendance: ParentAttendanceService,
  ) {}

  @Get(':id/absence-notices')
  list(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.notices.listForParent(user.id, id);
  }

  @Post(':id/absence-notices')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateNoticeDto,
  ) {
    return this.notices.createForParent(user.id, id, dto);
  }

  @Post(':id/absence-notices/:noticeId/cancel')
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('noticeId') noticeId: string,
  ) {
    return this.notices.cancelForParent(user.id, id, noticeId);
  }

  @Get(':id/register')
  register(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query('month') month: string,
  ) {
    return this.attendance.month(user.id, id, month);
  }
}
