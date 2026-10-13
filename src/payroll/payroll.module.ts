import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { SalaryTermsController } from './salary-terms.controller';
import { SalaryTermsService } from './salary-terms.service';

@Module({
  imports: [AttendanceModule],
  controllers: [SalaryTermsController],
  providers: [SalaryTermsService],
})
export class PayrollModule {}
