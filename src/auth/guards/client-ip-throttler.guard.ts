import { ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler';
import { isTrustedProxy } from './secret-matches';

/**
 * Browser traffic reaches the API through the frontend's Express proxy, so req.ip is
 * that server's address for every visitor. The proxy forwards the visitor's address in
 * X-Client-IP together with X-Proxy-Key; only then is X-Client-IP trusted, otherwise a
 * direct caller could pick any IP it likes.
 */
export function resolveClientIp(req: Record<string, any>): string {
  const clientIp = req.headers['x-client-ip'];
  if (isTrustedProxy(req) && typeof clientIp === 'string' && clientIp) {
    return clientIp;
  }
  return req.ip;
}

@Injectable()
export class ClientIpThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return resolveClientIp(req);
  }

  // Server-side renders come from the frontend server itself, with no browser behind
  // them (no X-Client-IP); throttling them would throttle the whole site at once.
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    return isTrustedProxy(req) && !req.headers['x-client-ip'];
  }

  // Replaces the default English "ThrottlerException: Too Many Requests" with a Georgian message.
  protected async throwThrottlingException(
    _context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const seconds = Math.max(1, detail.timeToBlockExpire || detail.timeToExpire || 60);
    const wait = seconds >= 60 ? `${Math.ceil(seconds / 60)} წუთის` : `${seconds} წამის`;
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: `მოთხოვნების ლიმიტი ამოიწურა. გთხოვთ, სცადოთ ${wait} შემდეგ.`,
        error: 'Too Many Requests',
        retryAfterSeconds: seconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

// For authenticated routes: limits per user instead of per IP, so different accounts
// behind the same IP (office, shared network, testing several users) don't share a bucket.
@Injectable()
export class UserThrottlerGuard extends ClientIpThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return req.user?.id ? `user:${req.user.id}` : resolveClientIp(req);
  }
}
