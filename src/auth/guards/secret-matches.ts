import { createHash, timingSafeEqual } from 'crypto';

/**
 * Constant-time comparison of a request header against a configured secret.
 * Always false when the secret isn't configured, so endpoints fail closed.
 */
export function secretMatches(provided: unknown, expected: string | undefined): boolean {
  if (!expected || typeof provided !== 'string' || !provided) return false;
  // Hashing first gives equal-length buffers, which timingSafeEqual requires.
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/** True when the request was relayed by our own frontend server (Express proxy or SSR). */
export function isTrustedProxy(req: Record<string, any>): boolean {
  return secretMatches(req.headers?.['x-proxy-key'], process.env.PROXY_SHARED_SECRET);
}
