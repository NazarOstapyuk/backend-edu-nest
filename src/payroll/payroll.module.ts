import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { MyPayrollController } from './my-payroll.controller';
import { PayrollBuilder } from './payroll-builder.service';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';
import { SalaryTermsController } from './salary-terms.controller';
import { SalaryTermsService } from './salary-terms.service';

@Module({
  imports: [AttendanceModule],
  controllers: [SalaryTermsController, PayrollController, MyPayrollController],
  providers: [SalaryTermsService, PayrollBuilder, PayrollService],
})
export class PayrollModule {}
