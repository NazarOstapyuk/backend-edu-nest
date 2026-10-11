import { ClassFormat } from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateClassGroupDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Matches(/\S/)
  @IsOptional()
  name?: string;

  @IsEnum(ClassFormat)
  @IsOptional()
  format?: ClassFormat;

  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  teacherIds?: string[];

  @IsUUID('4')
  @IsOptional()
  singleTariffId?: string | null;

  @IsUUID('4')
  @IsOptional()
  packageTariffId?: string | null;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
