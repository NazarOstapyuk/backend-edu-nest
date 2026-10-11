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
import { ChargesService } from './charges.service';
import { AllocateDto } from './dto/allocate.dto';
import { BalancesQueryDto } from './dto/balances-query.dto';
import { VoidDto } from './dto/void.dto';
import { FinanceService } from './finance.service';
import { PaymentsService } from './payments.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.root, Role.admin)
@Controller()
export class FinanceController {
  constructor(
    private finance: FinanceService,
    private charges: ChargesService,
    private payments: PaymentsService,
  ) {}

  @Get('finance/balances')
  getBalances(@Query() query: BalancesQueryDto) {
    return this.finance.getBalances(query);
  }

  @Post('charges/:id/void')
  async voidCharge(
    @Param('id') id: string,
    @Body() dto: VoidDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const charge = await this.charges.void(id, dto.reason, user.id);
    return this.finance.getChildFinance(charge.childId);
  }

  @Post('payments/:id/allocations')
  async allocate(
    @Param('id') id: string,
    @Body() dto: AllocateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const payment = await this.payments.allocate(id, dto.allocations, user.id);
    return this.finance.getChildFinance(payment.childId);
  }

  @Post('payments/:id/void')
  async voidPayment(
    @Param('id') id: string,
    @Body() dto: VoidDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const payment = await this.payments.void(id, dto.reason, user.id);
    return this.finance.getChildFinance(payment.childId);
  }

  @Post('allocations/:id/void')
  async voidAllocation(
    @Param('id') id: string,
    @Body() dto: VoidDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const { childId } = await this.payments.voidAllocation(
      id,
      dto.reason,
      user.id,
    );
    return this.finance.getChildFinance(childId);
  }
}
