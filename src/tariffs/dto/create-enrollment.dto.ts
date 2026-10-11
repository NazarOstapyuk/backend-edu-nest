import { BillingMode } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateEnrollmentDto {
  @IsUUID('4')
  tariffId: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;

  @IsEnum(BillingMode)
  @IsOptional()
  billingMode?: BillingMode;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  note?: string;
}
