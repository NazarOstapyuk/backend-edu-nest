// src/users/dto/create-user.dto.ts
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
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

  @IsEnum(Role)
  role: Role;

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
