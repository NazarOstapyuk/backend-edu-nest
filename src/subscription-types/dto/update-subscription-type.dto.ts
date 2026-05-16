import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateSubscriptionTypeDto } from './create-subscription-type.dto';

export class UpdateSubscriptionTypeDto extends PartialType(CreateSubscriptionTypeDto) {
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
