import { CashDirection } from '@prisma/client';
import {
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { AMOUNT_PATTERN } from '../../finance/finance-calc';

export class CorrectionDto {
  @IsIn([1, -1])
  sign: 1 | -1;

  @IsString()
  @Matches(AMOUNT_PATTERN)
  amount: string;

  @IsOptional()
  @IsEnum(CashDirection)
  direction?: CashDirection;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(500)
  comment: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  correctsId?: string;
}
