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
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { AbsenceReasonsService } from './absence-reasons.service';
import { CreateAbsenceReasonDto } from './dto/create-absence-reason.dto';
import { UpdateAbsenceReasonDto } from './dto/update-absence-reason.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.root, Role.admin)
@Controller('absence-reasons')
export class AbsenceReasonsController {
  constructor(private reasons: AbsenceReasonsService) {}

  @Get()
  @Roles(Role.root, Role.admin, Role.teacher, Role.parent)
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.reasons.list(user);
  }

  @Post()
  create(@Body() dto: CreateAbsenceReasonDto) {
    return this.reasons.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAbsenceReasonDto) {
    return this.reasons.update(id, dto);
  }
}
