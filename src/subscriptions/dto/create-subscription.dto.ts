import { IsInt, IsPositive, IsUUID } from 'class-validator';

export class CreateSubscriptionDto {
  @IsUUID()
  childId: string;

  @IsUUID()
  subscriptionTypeId: string;

  @IsInt()
  @IsPositive()
  totalSessions: number;
}
