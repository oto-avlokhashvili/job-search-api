import { CanActivate, Injectable, Logger } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') implements CanActivate {
  private readonly logger = new Logger(GoogleAuthGuard.name);

  /**
   * Never throws: on the callback a failure (consent cancelled, access denied, sign-up error)
   * leaves req.user empty, and the controller sends the visitor back to the site instead of
   * showing a raw JSON error on the API's domain.
   */
  handleRequest(err: any, user: any, info: any) {
    if (err || !user) {
      this.logger.warn(`Google sign-in failed: ${err?.message || info?.message || 'no user'}`);
      return null;
    }
    return user;
  }
}
