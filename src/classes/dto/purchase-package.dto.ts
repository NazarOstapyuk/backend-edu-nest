import { IsDateString, IsUUID } from 'class-validator';

export class PurchasePackageDto {
  @IsUUID('4')
  directionId: string;

  @IsUUID('4')
  tariffId: string;

  @IsDateString()
  purchaseDate: string;
}
