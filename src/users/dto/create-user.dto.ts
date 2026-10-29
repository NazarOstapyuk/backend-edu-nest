// src/users/dto/create-user.dto.ts
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  ValidateIf,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AccessScope, Role } from '@prisma/client';
import { PHONE_PATTERN } from '../../common/validation/contacts';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  login: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsIn([Role.parent, Role.root])
  @IsOptional()
  role?: 'parent' | 'root';

  @IsUUID('4')
  @IsOptional()
  positionId?: string;

  @IsIn([AccessScope.all, AccessScope.institutions])
  @IsOptional()
  accessScope?: AccessScope;

  @ValidateIf((o: CreateUserDto) => o.accessScope === AccessScope.institutions)
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  institutionIds?: string[];

  @IsString()
  @MinLength(3)
  @IsNotEmpty()
  firstName: string;

  @IsString()
  @MinLength(3)
  @IsNotEmpty()
  lastName: string;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  middleName?: string;

  @Matches(PHONE_PATTERN)
  @IsOptional()
  phone?: string;

  @IsEmail()
  @MaxLength(200)
  @IsOptional()
  email?: string;
}
