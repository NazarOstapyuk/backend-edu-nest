import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { PayrollService } from './payroll.service';
import { MyPayrollQueryDto } from './dto/payroll.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.teacher)
@Controller('me/payroll')
export class MyPayrollController {
  constructor(private payroll: PayrollService) {}

  @Get()
  year(
    @Query() query: MyPayrollQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.payroll.myYear(user, query.year);
  }

  @Get(':month')
  month(@Param('month') month: string, @CurrentUser() user: AuthenticatedUser) {
    return this.payroll.myMonth(user, month);
  }
}
