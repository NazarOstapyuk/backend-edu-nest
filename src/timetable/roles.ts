import { Role } from '@prisma/client';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';

export const isAdmin = (user: AuthenticatedUser): boolean =>
  user.role === Role.root || user.role === Role.admin;
