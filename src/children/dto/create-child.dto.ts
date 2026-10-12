import { Gender } from '@prisma/client';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateChildDto {
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @IsString()
  @IsNotEmpty()
  lastName: string;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  middleName?: string;

  @IsDateString()
  birthDate: string;

  @IsEnum(Gender)
  gender: Gender;

  @IsUUID('4')
  @IsOptional()
  groupId?: string;

  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  parentIds?: string[];
}
