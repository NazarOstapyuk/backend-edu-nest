import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import { InstitutionType } from '@prisma/client';

export class UpdateInstitutionDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(2, 100)
  @Matches(/\S/)
  @IsOptional()
  name?: string;

  @IsEnum(InstitutionType)
  @IsOptional()
  type?: InstitutionType;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
