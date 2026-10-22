import { Transform } from 'class-transformer';
import { IsEnum, IsString, Length, Matches } from 'class-validator';
import { InstitutionType } from '@prisma/client';

export class CreateInstitutionDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(2, 100)
  @Matches(/\S/)
  name: string;

  @IsEnum(InstitutionType)
  type: InstitutionType;
}
