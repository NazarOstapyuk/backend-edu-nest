import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PermissionArea, PermissionLevel } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Permission } from '../common/decorators/permission.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { ChargesService } from './charges.service';
import { AllocationSuggestionDto } from './dto/allocation-suggestion.dto';
import { CreateChargeDto } from './dto/create-charge.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { FinanceService } from './finance.service';
import { PaymentsService } from './payments.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Permission(PermissionArea.finance, PermissionLevel.view)
@Controller('children/:childId')
export class ChildFinanceController {
  constructor(
    private finance: FinanceService,
    private charges: ChargesService,
    private payments: PaymentsService,
  ) {}

  @Get('finance')
  getFinance(@Param('childId') childId: string) {
    return this.finance.getChildFinance(childId);
  }

  @Get('finance/history')
  getHistory(@Param('childId') childId: string) {
    return this.finance.getHistory(childId);
  }

  @Post('allocation-suggestion')
  @HttpCode(200)
  suggest(
    @Param('childId') childId: string,
    @Body() dto: AllocationSuggestionDto,
  ) {
    return this.finance.suggest(childId, dto);
  }

  @Permission(PermissionArea.finance, PermissionLevel.edit)
  @Post('charges')
  async createCharge(
    @Param('childId') childId: string,
    @Body() dto: CreateChargeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.charges.create(childId, dto, user.id);
    return this.finance.getChildFinance(childId);
  }

  @Permission(PermissionArea.finance, PermissionLevel.edit)
  @Post('payments')
  async createPayment(
    @Param('childId') childId: string,
    @Body() dto: CreatePaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.payments.create(childId, dto, user.id);
    return this.finance.getChildFinance(childId);
  }
}
