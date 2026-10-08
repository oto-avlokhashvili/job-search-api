import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { secretMatches } from './secret-matches';

/**
 * For admin and server-to-server endpoints (scrapers, sitemap, job management).
 * Requires the X-Internal-Key header to equal INTERNAL_API_KEY; when that variable
 * isn't set, every request is rejected.
 */
@Injectable()
export class InternalKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    if (!secretMatches(req.headers['x-internal-key'], process.env.INTERNAL_API_KEY)) {
      throw new UnauthorizedException('This endpoint is internal');
    }
    return true;
  }
}
