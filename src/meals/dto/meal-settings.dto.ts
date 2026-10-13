import { IsString } from 'class-validator';

export class UpdateMealSettingsDto {
  @IsString()
  mealOrderDeadline: string;
}
