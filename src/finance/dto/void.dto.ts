import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class VoidDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(500)
  reason: string;
}
