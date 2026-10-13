import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PayrollCalendar, PayrollLessonType } from '@prisma/client';
import { AMOUNT_PATTERN } from '../../finance/finance-calc';

export class SalaryRateDto {
  @IsEnum(PayrollLessonType)
  lessonType: PayrollLessonType;

  @IsOptional()
  @IsUUID('4')
  subjectId?: string;

  @IsOptional()
  @IsUUID('4')
  classGroupId?: string;

  @IsString()
  @Matches(AMOUNT_PATTERN)
  amount: string;
}

export class SalaryAllowanceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(/\S/)
  name: string;

  @IsString()
  @Matches(AMOUNT_PATTERN)
  amount: string;
}

export class UpdateSalaryTermsDto {
  @IsOptional()
  @IsString()
  @Matches(AMOUNT_PATTERN)
  monthlyRate?: string;

  @IsOptional()
  @IsEnum(PayrollCalendar)
  calendarKind?: PayrollCalendar;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SalaryRateDto)
  rates?: SalaryRateDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SalaryAllowanceDto)
  allowances?: SalaryAllowanceDto[];
}

export class CreateSalaryTermsDto {
  @IsUUID('4')
  teacherId: string;

  @IsDateString()
  validFrom: string;

  @IsString()
  @Matches(AMOUNT_PATTERN)
  monthlyRate: string;

  @IsEnum(PayrollCalendar)
  calendarKind: PayrollCalendar;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SalaryRateDto)
  rates: SalaryRateDto[];

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SalaryAllowanceDto)
  allowances: SalaryAllowanceDto[];
}

export class CloseSalaryTermsDto {
  @IsDateString()
  validTo: string;
}

export class SalaryTermsQueryDto {
  @IsUUID('4')
  teacherId: string;
}
