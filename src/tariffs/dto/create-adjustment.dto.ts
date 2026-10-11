import { AdjustmentType } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { AMOUNT_PATTERN } from '../../finance/finance-calc';

export class CreateAdjustmentDto {
  @IsEnum(AdjustmentType)
  type: AdjustmentType;

  @IsString()
  @Matches(AMOUNT_PATTERN)
  @IsOptional()
  value?: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(500)
  reason: string;
}
