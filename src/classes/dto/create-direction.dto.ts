import { MissedLessonRule } from '@prisma/client';
import {
  IsEnum,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateDirectionDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Matches(/\S/)
  name: string;

  @IsEnum(MissedLessonRule)
  missedRule: MissedLessonRule;
}
