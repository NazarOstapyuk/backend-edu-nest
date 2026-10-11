import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, ValidateNested } from 'class-validator';
import { AllocationItemDto } from './allocation-item.dto';

export class AllocateDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AllocationItemDto)
  allocations: AllocationItemDto[];
}
