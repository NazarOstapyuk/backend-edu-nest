import { BillingMode } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateTariffDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Matches(/\S/)
  @IsOptional()
  name?: string;

  @IsEnum(BillingMode)
  @IsOptional()
  billingMode?: BillingMode;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
