import { IsInt } from 'class-validator';

export class UpdateBillingSettingsDto {
  @IsInt()
  chargeLeadDays: number;
}
