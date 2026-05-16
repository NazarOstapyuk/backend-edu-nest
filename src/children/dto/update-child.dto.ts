import { Gender } from '@prisma/client';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class UpdateChildDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  firstName?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  lastName?: string;

  @IsDateString()
  @IsOptional()
  birthDate?: string;

  @IsEnum(Gender)
  @IsOptional()
  gender?: Gender;

  // @IsOptional skips validation for both undefined and null,
  // allowing null to explicitly disconnect the child from a group.
  @IsUUID('4')
  @IsOptional()
  groupId?: string | null;

  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  parentIds?: string[];
}
