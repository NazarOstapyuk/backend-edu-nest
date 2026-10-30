// src/users/dto/update-user.dto.ts
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
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
import { AccessScope, Role } from '@prisma/client';
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

  @IsIn([AccessScope.all, AccessScope.institutions])
  @IsOptional()
  accessScope?: AccessScope;

  @ValidateIf((o: UpdateUserDto) => o.accessScope === AccessScope.institutions)
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  institutionIds?: string[];

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
