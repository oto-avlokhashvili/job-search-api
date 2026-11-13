import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { secretMatches } from 'src/auth/guards/secret-matches';
import { stripHiddenLinks } from './public-link';

/**
 * Global: no response carries an imported vacancy's original link, except LinkedIn and Job Up's own
 * (see public-link.ts). Server-to-server calls with the internal key get the data unchanged.
 */
@Injectable()
export class HideSourceLinksInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest();
    if (secretMatches(req?.headers?.['x-internal-key'], process.env.INTERNAL_API_KEY)) return next.handle();
    return next.handle().pipe(map((body) => stripHiddenLinks(body)));
  }
}
