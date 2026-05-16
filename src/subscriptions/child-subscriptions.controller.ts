import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { SubscriptionsService } from './subscriptions.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.root, Role.admin, Role.teacher, Role.parent)
@Controller('children')
export class ChildSubscriptionsController {
  constructor(private service: SubscriptionsService) {}

  @Get(':childId/subscriptions')
  findByChild(
    @Param('childId') childId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.findByChild(childId, user);
  }
}
