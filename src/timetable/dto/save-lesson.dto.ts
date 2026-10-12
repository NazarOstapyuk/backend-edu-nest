import { LessonStatus, NushLevel } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class LessonMarkDto {
  @IsUUID('4')
  childId: string;

  @IsEnum(LessonStatus)
  status: LessonStatus;

  @IsUUID('4')
  @IsOptional()
  reasonId?: string;

  @IsEnum(NushLevel)
  @IsOptional()
  level?: NushLevel;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  comment?: string;
}

export class SaveLessonDto {
  @IsString()
  @MaxLength(500)
  @IsOptional()
  topic?: string;

  @IsString()
  @MaxLength(1000)
  @IsOptional()
  homework?: string;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  reason?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LessonMarkDto)
  marks: LessonMarkDto[];
}
