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
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { VoidDto } from '../finance/dto/void.dto';
import { PayrollService } from './payroll.service';
import {
  PayrollAdjustmentDto,
  PayrollListQueryDto,
  PayrollPaymentDto,
  WorkedDaysDto,
} from './dto/payroll.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.root, Role.admin)
@Controller()
export class PayrollController {
  constructor(private payroll: PayrollService) {}

  @Get('payroll')
  list(@Query() query: PayrollListQueryDto) {
    return this.payroll.list(query.month);
  }

  @Get('payroll/:teacherId/:month')
  detail(@Param('teacherId') teacherId: string, @Param('month') month: string) {
    return this.payroll.detail(teacherId, month);
  }

  @Patch('payroll/:teacherId/:month/worked-days')
  workedDays(
    @Param('teacherId') teacherId: string,
    @Param('month') month: string,
    @Body() dto: WorkedDaysDto,
  ) {
    return this.payroll.setWorkedDays(teacherId, month, dto.workedDays ?? null);
  }

  @Post('payroll/:teacherId/:month/adjustments')
  addAdjustment(
    @Param('teacherId') teacherId: string,
    @Param('month') month: string,
    @Body() dto: PayrollAdjustmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.payroll.addAdjustment(teacherId, month, dto, user);
  }

  @Post('payroll-adjustments/:id/void')
  voidAdjustment(
    @Param('id') id: string,
    @Body() dto: VoidDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.payroll.voidAdjustment(id, dto.reason, user);
  }

  @Post('payroll/:teacherId/:month/payments')
  addPayment(
    @Param('teacherId') teacherId: string,
    @Param('month') month: string,
    @Body() dto: PayrollPaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.payroll.addPayment(teacherId, month, dto, user);
  }

  @Post('payroll-payments/:id/void')
  voidPayment(
    @Param('id') id: string,
    @Body() dto: VoidDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.payroll.voidPayment(id, dto.reason, user);
  }

  @Post('payroll/:teacherId/:month/approve')
  approve(
    @Param('teacherId') teacherId: string,
    @Param('month') month: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.payroll.approve(teacherId, month, user);
  }

  @Post('payroll/:teacherId/:month/reopen')
  reopen(
    @Param('teacherId') teacherId: string,
    @Param('month') month: string,
    @Body() dto: VoidDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.payroll.reopen(teacherId, month, dto.reason, user);
  }
}
