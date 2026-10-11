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
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { DirectionsService } from './directions.service';
import { CreateDirectionDto } from './dto/create-direction.dto';
import { UpdateDirectionDto } from './dto/update-direction.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.root, Role.admin)
@Controller('directions')
export class DirectionsController {
  constructor(private directions: DirectionsService) {}

  @Get()
  list() {
    return this.directions.list();
  }

  @Post()
  create(@Body() dto: CreateDirectionDto) {
    return this.directions.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateDirectionDto) {
    return this.directions.update(id, dto);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.directions.delete(id);
  }
}
