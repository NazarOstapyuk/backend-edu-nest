import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class OrderDayDto {
  @IsDateString()
  date: string;

  @IsUUID('4')
  complexId: string;

  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  dishIds: string[];
}

export class ParentMealOrdersDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(31)
  @ValidateNested({ each: true })
  @Type(() => OrderDayDto)
  days: OrderDayDto[];
}

export class AdminMealOrdersDto extends ParentMealOrdersDto {
  @IsUUID('4')
  childId: string;
}

export class CancelMealOrderDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @IsOptional()
  reason?: string;
}
