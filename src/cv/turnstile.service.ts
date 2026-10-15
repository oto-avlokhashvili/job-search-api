import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Cloudflare Turnstile check for anonymous forms.
 * Disabled until TURNSTILE_SECRET_KEY is set, so local dev works without a Cloudflare account.
 */
@Injectable()
export class TurnstileService {
  private readonly logger = new Logger(TurnstileService.name);
  private warnedDisabled = false;

  constructor(private readonly config: ConfigService) {}

  async verify(token: string | undefined, remoteIp: string): Promise<void> {
    const secret = this.config.get<string>('TURNSTILE_SECRET_KEY');
    if (!secret) {
      if (!this.warnedDisabled) {
        this.logger.warn('TURNSTILE_SECRET_KEY is not set: bot verification is disabled');
        this.warnedDisabled = true;
      }
      return;
    }

    if (!token) {
      throw new BadRequestException('გთხოვთ გაიაროთ ბოტისგან დაცვის შემოწმება');
    }

    let success = false;
    try {
      const { data } = await axios.post(
        SITEVERIFY_URL,
        new URLSearchParams({ secret, response: token, remoteip: remoteIp }),
        { timeout: 5000 },
      );
      success = data?.success === true;
    } catch (e: any) {
      this.logger.error(`Turnstile verification request failed: ${e.message}`);
      throw new ServiceUnavailableException('შემოწმება ვერ მოხერხდა, სცადეთ თავიდან');
    }

    if (!success) {
      throw new BadRequestException('ბოტისგან დაცვის შემოწმება ვერ გაიარა, სცადეთ თავიდან');
    }
  }
}
