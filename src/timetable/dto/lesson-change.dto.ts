import { LessonChangeType } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateLessonChangeDto {
  @IsString()
  date: string;

  @IsInt()
  @Min(1)
  period: number;

  @IsUUID('4')
  @IsOptional()
  subgroupId?: string;

  @IsEnum(LessonChangeType)
  type: LessonChangeType;

  @IsUUID('4')
  @IsOptional()
  subjectId?: string;

  @IsUUID('4')
  @IsOptional()
  teacherId?: string;

  @IsUUID('4')
  @IsOptional()
  roomId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
