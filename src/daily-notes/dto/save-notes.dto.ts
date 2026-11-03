import { Type } from 'class-transformer';
import {
  Allow,
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class NoteAnswerInputDto {
  @IsUUID('4')
  childId: string;

  @IsUUID('4')
  questionId: string;

  @Allow()
  value: unknown;
}

export class SaveNotesDto {
  @IsString()
  @MaxLength(500)
  @IsOptional()
  reason?: string;

  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => NoteAnswerInputDto)
  answers: NoteAnswerInputDto[];
}
