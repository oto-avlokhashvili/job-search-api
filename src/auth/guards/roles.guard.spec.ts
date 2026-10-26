import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { UserRole } from 'src/enums/user-role.enum';

const ctx = (user: any) =>
  ({
    getHandler: () => null,
    getClass: () => null,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as any;

const guardFor = (roles?: UserRole[]) => {
  const reflector = { getAllAndOverride: () => roles } as unknown as Reflector;
  return new RolesGuard(reflector);
};

describe('RolesGuard', () => {
  it('allows any user when no roles are required', () => {
    expect(guardFor().canActivate(ctx({ role: UserRole.USER }))).toBe(true);
  });

  it('rejects a user whose role is not listed', () => {
    expect(() => guardFor([UserRole.HR]).canActivate(ctx({ role: UserRole.USER }))).toThrow(ForbiddenException);
  });

  it('rejects a missing user', () => {
    expect(() => guardFor([UserRole.HR]).canActivate(ctx(undefined))).toThrow(ForbiddenException);
  });

  it('rejects an HR account that is not approved yet', () => {
    expect(() => guardFor([UserRole.HR]).canActivate(ctx({ role: UserRole.HR, hrApproved: false }))).toThrow(
      'awaiting admin approval',
    );
  });

  it('allows an approved HR account and admins', () => {
    const guard = guardFor([UserRole.HR, UserRole.ADMIN]);
    expect(guard.canActivate(ctx({ role: UserRole.HR, hrApproved: true }))).toBe(true);
    expect(guard.canActivate(ctx({ role: UserRole.ADMIN }))).toBe(true);
  });
});
