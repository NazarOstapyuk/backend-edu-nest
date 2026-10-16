import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PermissionArea, PermissionLevel } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permission } from '../common/decorators/permission.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { CreateLinkDto } from './dto/online-payment.dto';
import { OnlinePaymentsService } from './online-payments.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class StaffOnlinePaymentsController {
  constructor(private payments: OnlinePaymentsService) {}

  @Post('children/:childId/payment-links')
  @Permission(PermissionArea.finance, PermissionLevel.edit)
  createLink(
    @CurrentUser() user: AuthenticatedUser,
    @Param('childId', ParseUUIDPipe) childId: string,
    @Body() dto: CreateLinkDto,
  ) {
    return this.payments.createLink(user, childId, dto);
  }

  @Get('children/:childId/payment-requests')
  @Permission(PermissionArea.finance, PermissionLevel.view)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('childId', ParseUUIDPipe) childId: string,
  ) {
    return this.payments.listRequests(user, childId);
  }

  @Post('payment-requests/:id/cancel')
  @Permission(PermissionArea.finance, PermissionLevel.edit)
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.payments.cancel(user, id);
  }
}
