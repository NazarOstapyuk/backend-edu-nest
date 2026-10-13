import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PayrollService } from './payroll.service';
import { PayrollListQueryDto } from './dto/payroll.dto';

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
}
