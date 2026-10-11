import { IsInt, IsPositive } from 'class-validator';

export class UpdateSubscriptionDto {
  @IsInt()
  @IsPositive()
  totalSessions: number;
}
