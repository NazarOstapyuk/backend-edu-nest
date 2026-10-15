import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PermissionArea, PermissionLevel } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Permission } from '../common/decorators/permission.decorator';
import { DirectionsService } from './directions.service';
import { CreateDirectionDto } from './dto/create-direction.dto';
import { UpdateDirectionDto } from './dto/update-direction.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Permission(PermissionArea.classes, PermissionLevel.view)
@Controller('directions')
export class DirectionsController {
  constructor(private directions: DirectionsService) {}

  @Get()
  list() {
    return this.directions.list();
  }

  @Permission(PermissionArea.classes, PermissionLevel.edit)
  @Post()
  create(@Body() dto: CreateDirectionDto) {
    return this.directions.create(dto);
  }

  @Permission(PermissionArea.classes, PermissionLevel.edit)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateDirectionDto) {
    return this.directions.update(id, dto);
  }

  @Permission(PermissionArea.classes, PermissionLevel.edit)
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.directions.delete(id);
  }
}
