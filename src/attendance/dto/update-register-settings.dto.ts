import { IsInt } from 'class-validator';

export class UpdateRegisterSettingsDto {
  @IsInt()
  editDays: number;
}
