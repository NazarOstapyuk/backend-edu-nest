import { IsNumber, IsPositive, IsString, MinLength } from 'class-validator';

export class CreateSubscriptionTypeDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  pricePerSession: number;
}
