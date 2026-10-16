import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { PayCategoryDto } from './dto/online-payment.dto';
import { OnlinePaymentsService } from './online-payments.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.parent)
@Controller('me')
export class ParentOnlinePaymentsController {
  constructor(private payments: OnlinePaymentsService) {}

  @Post('children/:id/online-payments')
  pay(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PayCategoryDto,
  ) {
    return this.payments.payFromCabinet(user.id, id, dto);
  }

  @Get('online-payments/:invoiceId')
  invoice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
  ) {
    return this.payments.parentInvoice(user.id, invoiceId);
  }
}
