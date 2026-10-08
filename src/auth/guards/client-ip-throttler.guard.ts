import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { isTrustedProxy } from './secret-matches';

/**
 * Browser traffic reaches the API through the frontend's Express proxy, so req.ip is
 * that server's address for every visitor. The proxy forwards the visitor's address in
 * X-Client-IP together with X-Proxy-Key; only then is X-Client-IP trusted, otherwise a
 * direct caller could pick any IP it likes.
 */
@Injectable()
export class ClientIpThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const clientIp = req.headers['x-client-ip'];
    if (isTrustedProxy(req) && typeof clientIp === 'string' && clientIp) {
      return clientIp;
    }
    return req.ip;
  }

  // Server-side renders come from the frontend server itself, with no browser behind
  // them (no X-Client-IP); throttling them would throttle the whole site at once.
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    return isTrustedProxy(req) && !req.headers['x-client-ip'];
  }
}
