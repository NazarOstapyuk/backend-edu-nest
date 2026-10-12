import { DailyStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class RegisterMarkDto {
  @IsUUID('4')
  childId: string;

  @IsEnum(DailyStatus)
  status: DailyStatus;

  @IsUUID('4')
  @IsOptional()
  reasonId?: string;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  note?: string;

  @IsBoolean()
  @IsOptional()
  documentProvided?: boolean;
}

export class SaveRegisterDto {
  @IsString()
  date: string;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  reason?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RegisterMarkDto)
  marks: RegisterMarkDto[];
}
