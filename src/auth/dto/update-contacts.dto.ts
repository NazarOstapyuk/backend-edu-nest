import {
  IsEmail,
  IsOptional,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { PHONE_PATTERN } from '../../common/validation/contacts';

export class UpdateContactsDto {
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
