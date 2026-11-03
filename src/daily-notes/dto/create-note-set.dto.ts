import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { NoteQuestionDto } from './note-question.dto';

export class CreateNoteSetDto {
  @IsUUID('4')
  institutionId: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  deadline?: string;

  @IsArray()
  @IsUUID('4', { each: true })
  groupIds: string[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NoteQuestionDto)
  questions: NoteQuestionDto[];
}
