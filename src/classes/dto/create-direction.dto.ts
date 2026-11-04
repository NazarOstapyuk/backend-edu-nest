import { ClassFormat, MissedLessonRule } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class DirectionGroupDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Matches(/\S/)
  @IsOptional()
  name?: string;

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

export class CreateDirectionDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Matches(/\S/)
  name: string;

  @IsEnum(MissedLessonRule)
  missedRule: MissedLessonRule;

  @ValidateNested()
  @Type(() => DirectionGroupDto)
  @IsOptional()
  group?: DirectionGroupDto;
}
