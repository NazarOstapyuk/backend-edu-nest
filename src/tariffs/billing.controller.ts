import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { BillingService } from './billing.service';
import { UpdateBillingSettingsDto } from './dto/update-billing-settings.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.root, Role.admin)
@Controller()
export class BillingController {
  constructor(private billing: BillingService) {}

  @Post('billing/run')
  @HttpCode(200)
  run(@CurrentUser() user: AuthenticatedUser) {
    return this.billing.runAll(user.id);
  }

  @Get('billing/problems')
  problems() {
    return this.billing.problems();
  }

  @Get('settings/billing')
  async getSettings() {
    return { chargeLeadDays: await this.billing.getLeadDays() };
  }

  @Patch('settings/billing')
  updateSettings(@Body() dto: UpdateBillingSettingsDto) {
    return this.billing.setLeadDays(dto.chargeLeadDays);
  }
}
