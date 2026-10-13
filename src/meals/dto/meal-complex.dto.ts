import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { AMOUNT_PATTERN } from '../../finance/finance-calc';

export class CreateMealComplexDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(/\S/)
  name: string;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  description?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  courseIds: string[];
}

export class UpdateMealComplexDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(/\S/)
  @IsOptional()
  name?: string;

  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(500)
  @IsOptional()
  description?: string | null;

  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;

  @IsBoolean()
  @IsOptional()
  active?: boolean;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  @IsOptional()
  courseIds?: string[];
}

export class AddComplexPriceDto {
  @IsUUID('4')
  priceCategoryId: string;

  @IsString()
  @Matches(AMOUNT_PATTERN)
  price: string;

  @IsDateString()
  validFrom: string;
}
