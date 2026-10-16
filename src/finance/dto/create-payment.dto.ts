import { FinanceCategory, PaymentMethod } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { AMOUNT_PATTERN } from '../finance-calc';
import { AllocationItemDto } from './allocation-item.dto';

export class CreatePaymentDto {
  @IsString()
  @Matches(AMOUNT_PATTERN)
  amount: string;

  @IsIn([PaymentMethod.cash, PaymentMethod.bank_transfer, PaymentMethod.card])
  method: PaymentMethod;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(255)
  reference: string;

  @IsDateString()
  receivedAt: string;

  @IsEnum(FinanceCategory)
  @IsOptional()
  category?: FinanceCategory;

  @IsString()
  @MaxLength(1000)
  @IsOptional()
  note?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AllocationItemDto)
  @IsOptional()
  allocations?: AllocationItemDto[];
}
