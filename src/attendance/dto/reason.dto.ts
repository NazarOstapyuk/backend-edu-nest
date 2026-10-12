import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ReasonDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
