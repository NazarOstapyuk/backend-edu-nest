import { IsString } from 'class-validator';

export class PayrollListQueryDto {
  @IsString()
  month: string;
}

export class MyPayrollQueryDto {
  @IsString()
  year: string;
}
