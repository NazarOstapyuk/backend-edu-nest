import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class VoidDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
