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
import { ChildrenService } from './children.service';
import { CreateChildDto } from './dto/create-child.dto';
import { UpdateChildDto } from './dto/update-child.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.root, Role.admin, Role.teacher)
@Controller('children')
export class ChildrenController {
  constructor(private childrenService: ChildrenService) {}

  @Post()
  create(@Body() dto: CreateChildDto) {
    return this.childrenService.create(dto);
  }

  @Get()
  findAll() {
    return this.childrenService.findAll();
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateChildDto) {
    return this.childrenService.update(id, dto);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.childrenService.delete(id);
  }
}
