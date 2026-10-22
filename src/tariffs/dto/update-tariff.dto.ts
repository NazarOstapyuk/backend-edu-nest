import { BillingMode } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
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

  @IsInt()
  @Min(1)
  @Max(3650)
  @IsOptional()
  validityDays?: number | null;

  @ValidateIf((_, v) => v !== null)
  @IsUUID('4')
  @IsOptional()
  institutionId?: string | null;
}
