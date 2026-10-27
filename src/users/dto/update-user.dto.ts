// src/users/dto/update-user.dto.ts
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  IsEmail,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Role } from '@prisma/client';
import { PHONE_PATTERN } from '../../common/validation/contacts';

export class UpdateUserDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  login?: string;

  @IsString()
  @MinLength(6)
  @IsOptional()
  password?: string;

  @IsIn([Role.parent])
  @IsOptional()
  role?: 'parent';

  @IsUUID('4')
  @IsOptional()
  positionId?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  firstName?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  lastName?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(100)
  @IsOptional()
  middleName?: string | null;

  @ValidateIf((_, value) => value !== null)
  @Matches(PHONE_PATTERN)
  @IsOptional()
  phone?: string | null;

  @ValidateIf((_, value) => value !== null)
  @IsEmail()
  @MaxLength(200)
  @IsOptional()
  email?: string | null;
}
