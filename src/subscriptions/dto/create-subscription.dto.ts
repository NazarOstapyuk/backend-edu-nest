import { IsArray, IsInt, IsPositive, IsUUID } from 'class-validator';

export class CreateSubscriptionDto {
  @IsArray()
  @IsUUID('4', { each: true })
  childIds: string[];

  @IsUUID()
  subscriptionTypeId: string;

  @IsInt()
  @IsPositive()
  totalSessions: number;
}
