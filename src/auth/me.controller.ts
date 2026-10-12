import { Body, Controller, Patch, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AllowWithoutPasswordChange } from '../common/decorators/allow-without-password-change.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateContactsDto } from './dto/update-contacts.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('me')
export class MeController {
  constructor(private authService: AuthService) {}

  @AllowWithoutPasswordChange()
  @Post('password')
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.authService.changePassword(user.id, dto, res);
  }

  @Patch('contacts')
  updateContacts(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateContactsDto,
  ) {
    return this.authService.updateContacts(user.id, dto);
  }
}
