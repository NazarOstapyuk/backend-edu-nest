import { SetMetadata } from '@nestjs/common';

export const ALLOW_WITHOUT_PASSWORD_CHANGE = 'allowWithoutPasswordChange';
export const AllowWithoutPasswordChange = () =>
  SetMetadata(ALLOW_WITHOUT_PASSWORD_CHANGE, true);
