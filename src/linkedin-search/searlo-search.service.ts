import { Injectable, Logger } from '@nestjs/common';
import { GoogleResult } from './google-browser.service';

const API_URL = 'https://api.searlo.tech/api/v1/search/web';
const RESULTS_PER_PAGE = 10; // Searlo's maximum
const TIMEOUT_MS = 15000;

interface SearloOrganic {
  title?: string;
  link?: string;
  snippet?: string;
  description?: string;
}

/** A Searlo error worth falling back on (outage, no credits, rate limit, bad key). */
export class SearloError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/**
 * Google results through Searlo's API (https://searlo.tech): no browser, no CAPTCHA, searches run in parallel.
 * One credit per search; empty or failed searches are free. Off when SEARLO_API_KEY is not set.
 */
@Injectable()
export class SearloSearchService {
  private readonly logger = new Logger(SearloSearchService.name);
  private readonly apiKey = process.env.SEARLO_API_KEY ?? '';

  get enabled(): boolean {
    return !!this.apiKey;
  }

  async search(query: string, page = 1): Promise<GoogleResult[]> {
    const params = new URLSearchParams({ q: query, limit: String(RESULTS_PER_PAGE), page: String(page), hl: 'en' });
    let res: Response;
    try {
      res = await fetch(`${API_URL}?${params}`, {
        headers: { 'x-api-key': this.apiKey, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new SearloError(`request failed: ${(error as Error).message}`);
    }

    const body = await res.json().catch(() => null);
    if (!res.ok) {
      // Asking past the last page is a normal end of results, not a failure
      if (body?.errorCode === 'PAGE_OUT_OF_RANGE') return [];
      throw new SearloError(`${res.status} ${body?.errorCode ?? ''} ${body?.message ?? ''}`.trim(), res.status);
    }

    const remaining = res.headers.get('x-credits-remaining');
    if (remaining !== null && Number(remaining) < 200) this.logger.warn(`Searlo credits running low: ${remaining} left`);

    const organic: SearloOrganic[] = Array.isArray(body?.organic) ? body.organic : [];
    return organic
      .filter((r) => r.link && r.title)
      .map((r) => ({ title: r.title!, url: r.link!, snippet: r.snippet || r.description || '' }));
  }
}
