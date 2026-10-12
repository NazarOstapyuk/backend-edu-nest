import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { ParentCabinetService } from './parent-cabinet.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.parent)
@Controller('me')
export class ParentCabinetController {
  constructor(private cabinet: ParentCabinetService) {}

  @Get('family')
  family(@CurrentUser() user: AuthenticatedUser) {
    return this.cabinet.family(user.id);
  }

  @Get('children/:id')
  card(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.cabinet.card(user.id, id);
  }

  @Get('children/:id/finance')
  finance(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.cabinet.finance(user.id, id);
  }
}
