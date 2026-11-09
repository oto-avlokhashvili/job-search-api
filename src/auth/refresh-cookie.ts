import type { CookieOptions } from 'express';

export const REFRESH_COOKIE = 'refreshToken';

const UNIT_MS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
const SEVEN_DAYS_MS = 7 * UNIT_MS.d;

/** A jsonwebtoken-style duration ("7d", "12h", "30m", or plain seconds) in ms; 7 days when unreadable. */
export function durationMs(value: string | undefined): number {
  const match = /^\s*(\d+(?:\.\d+)?)\s*([smhdw]?)\s*$/i.exec(value ?? '');
  if (!match) return SEVEN_DAYS_MS;
  const ms = Number(match[1]) * (match[2] ? UNIT_MS[match[2].toLowerCase()] : 1000);
  return ms > 0 ? ms : SEVEN_DAYS_MS;
}

const baseOptions = (): CookieOptions => ({
  httpOnly: true,
  path: '/',
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
});

/**
 * The refresh cookie lives as long as the refresh token. Without maxAge it was a session cookie: gone
 * whenever the browser closed (iPhone Safari does that whenever iOS reclaims memory), so 30 minutes
 * later, when the access token expired, the user was logged out.
 */
export const refreshCookieOptions = (): CookieOptions => ({
  ...baseOptions(),
  maxAge: durationMs(process.env.REFRESH_JWT_EXPIRE_IN),
});

/** Clearing must use the same attributes the cookie was set with, or browsers keep it */
export const clearRefreshCookieOptions = (): CookieOptions => baseOptions();
