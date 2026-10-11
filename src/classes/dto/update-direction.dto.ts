import { MissedLessonRule } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateDirectionDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Matches(/\S/)
  @IsOptional()
  name?: string;

  @IsEnum(MissedLessonRule)
  @IsOptional()
  missedRule?: MissedLessonRule;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
