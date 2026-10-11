import { ClassFormat } from '@prisma/client';
import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateClassGroupDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Matches(/\S/)
  name: string;

  @IsUUID('4')
  directionId: string;

  @IsEnum(ClassFormat)
  format: ClassFormat;

  @IsArray()
  @IsUUID('4', { each: true })
  teacherIds: string[];

  @IsUUID('4')
  @IsOptional()
  singleTariffId?: string | null;

  @IsUUID('4')
  @IsOptional()
  packageTariffId?: string | null;
}
