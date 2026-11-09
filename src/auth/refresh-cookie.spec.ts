import { durationMs, refreshCookieOptions } from './refresh-cookie';

describe('refresh cookie', () => {
  it('reads token durations', () => {
    expect(durationMs('7d')).toBe(7 * 86_400_000);
    expect(durationMs('12h')).toBe(12 * 3_600_000);
    expect(durationMs('30m')).toBe(30 * 60_000);
    expect(durationMs('3600')).toBe(3_600_000);
    expect(durationMs(undefined)).toBe(7 * 86_400_000);
    expect(durationMs('soon')).toBe(7 * 86_400_000);
  });

  it('outlives the browser session', () => {
    const prev = process.env.REFRESH_JWT_EXPIRE_IN;
    process.env.REFRESH_JWT_EXPIRE_IN = '7d';
    expect(refreshCookieOptions()).toMatchObject({ httpOnly: true, path: '/', sameSite: 'lax', maxAge: 7 * 86_400_000 });
    process.env.REFRESH_JWT_EXPIRE_IN = prev;
  });
});
