import { SetMetadata } from '@nestjs/common';
import { UserRole } from 'src/enums/user-role.enum';

export const ROLES_KEY = 'roles';

/**
 * Restricts a route/controller to the given roles. Use after JwtAuthGuard.
 * Example: @Roles(UserRole.HR, UserRole.ADMIN)
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
