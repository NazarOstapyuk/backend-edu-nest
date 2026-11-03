import { NoteQuestionType } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class NoteQuestionDto {
  @IsOptional()
  @IsUUID('4')
  id?: string;

  @IsString()
  text: string;

  @IsEnum(NoteQuestionType)
  type: NoteQuestionType;

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  options?: string[];

  @IsOptional()
  @IsNumber()
  min?: number | null;

  @IsOptional()
  @IsNumber()
  max?: number | null;

  @IsOptional()
  @IsString()
  unit?: string | null;
}
