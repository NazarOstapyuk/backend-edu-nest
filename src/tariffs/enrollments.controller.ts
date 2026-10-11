import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
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
import { VoidDto } from '../finance/dto/void.dto';
import { BillingService } from './billing.service';
import { CreateAdjustmentDto } from './dto/create-adjustment.dto';
import { CreateEnrollmentDto } from './dto/create-enrollment.dto';
import { EndEnrollmentDto } from './dto/end-enrollment.dto';
import { EnrollmentsService } from './enrollments.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.root, Role.admin)
@Controller()
export class EnrollmentsController {
  constructor(
    private enrollments: EnrollmentsService,
    private billing: BillingService,
  ) {}

  @Get('children/:childId/enrollments')
  list(@Param('childId') childId: string) {
    return this.enrollments.listForChild(childId);
  }

  @Post('children/:childId/enrollments')
  create(
    @Param('childId') childId: string,
    @Body() dto: CreateEnrollmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.enrollments.create(childId, dto, user.id);
  }

  @Patch('enrollments/:id/end')
  end(@Param('id') id: string, @Body() dto: EndEnrollmentDto) {
    return this.enrollments.end(id, dto);
  }

  @Post('enrollments/:id/adjustments')
  addAdjustment(
    @Param('id') id: string,
    @Body() dto: CreateAdjustmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.enrollments.addAdjustment(id, dto, user.id);
  }

  @Post('adjustments/:id/void')
  voidAdjustment(
    @Param('id') id: string,
    @Body() dto: VoidDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.enrollments.voidAdjustment(id, dto.reason, user.id);
  }

  @Post('enrollments/:id/bill')
  @HttpCode(200)
  async bill(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    const result = await this.billing.billEnrollment(id, user.id);
    const childId = await this.enrollments.childIdOf(id);
    return {
      result,
      enrollments: await this.enrollments.listForChild(childId),
    };
  }

  @Post('billed-periods/:id/recalculate')
  async recalculate(
    @Param('id') id: string,
    @Body() dto: VoidDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const { childId } = await this.billing.recalculate(id, dto.reason, user.id);
    return this.enrollments.listForChild(childId);
  }
}
