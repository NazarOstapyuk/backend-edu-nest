import {
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export class ClearExpiryDto {
  @IsUUID('4')
  tariffId: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/S/)
  @MaxLength(500)
  reason: string;
}
