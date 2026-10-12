import {
  Body,
  Controller,
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
import { SubgroupsService } from './subgroups.service';
import { CreateSubgroupDto, UpdateSubgroupDto } from './dto/subgroup.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.root, Role.admin)
@Controller()
export class SubgroupsController {
  constructor(private subgroups: SubgroupsService) {}

  @Get('groups/:id/subgroups')
  @Roles(Role.root, Role.admin, Role.teacher)
  list(@Param('id') id: string) {
    return this.subgroups.list(id);
  }

  @Post('groups/:id/subgroups')
  create(@Param('id') id: string, @Body() dto: CreateSubgroupDto) {
    return this.subgroups.create(id, dto);
  }

  @Patch('subgroups/:id')
  update(@Param('id') id: string, @Body() dto: UpdateSubgroupDto) {
    return this.subgroups.update(id, dto);
  }
}
