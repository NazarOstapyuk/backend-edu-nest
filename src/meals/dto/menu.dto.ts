import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsOptional,
  IsUUID,
} from 'class-validator';

export class MenuPeriodDto {
  @IsUUID('4')
  institutionId: string;

  @IsDateString()
  from: string;

  @IsDateString()
  to: string;
}

export class MenuRangeDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  institutionIds: string[];

  @IsDateString()
  from: string;

  @IsDateString()
  to: string;
}

export class SaveMenuDayDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  institutionIds: string[];

  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  dishIds: string[];
}

export class CopyMenuDto {
  @IsUUID('4')
  sourceInstitutionId: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  institutionIds: string[];

  @IsDateString()
  fromStart: string;

  @IsDateString()
  fromEnd: string;

  @IsDateString()
  toStart: string;

  @IsBoolean()
  @IsOptional()
  overwrite?: boolean;
}
