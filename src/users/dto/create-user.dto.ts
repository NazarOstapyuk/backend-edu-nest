// src/users/dto/create-user.dto.ts
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Role } from '@prisma/client';
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
