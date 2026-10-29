import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { LinkedinSearchDto } from './dto/linkedin-search.dto';
import { GoogleBrowserService, GoogleResult } from './google-browser.service';
import { PublicCvLimitsService } from 'src/cv/public-cv-limits.service';
import { SearloSearchService } from './searlo-search.service';

export interface LinkedinProfile {
  name: string;
  headline: string | null;
  url: string;
  snippet: string;
}

const OPEN_TO_WORK_CLAUSE = '("open to work" OR "#opentowork" OR "looking for new opportunities")';
// Identical searches are answered from Redis (shared by all HRs, kept across deploys):
// saves Searlo credits and spares the browser fallback from CAPTCHAs.
const CACHE_TTL_SEC = 6 * 60 * 60;
// After a Searlo failure, go straight to the browser for a while instead of waiting on Searlo each time
const SEARLO_PAUSE_MS = 2 * 60 * 1000;

export type SearchProvider = 'searlo' | 'google-browser';

@Injectable()
export class LinkedinSearchService {
  private readonly logger = new Logger(LinkedinSearchService.name);
  private searloPausedUntil = 0;

  constructor(
    private readonly googleBrowser: GoogleBrowserService,
    private readonly cache: PublicCvLimitsService,
    private readonly searlo: SearloSearchService,
  ) {}

  /**
   * site:linkedin.com/in ("Angular" OR "React") "Tbilisi" ("open to work" OR ...)
   */
  buildQuery(keyword: string, location?: string): string {
    const keywords = keyword
      .split(',')
      .map((k) => this.quote(k))
      .filter(Boolean);

    const parts = ['site:linkedin.com/in', `(${keywords.join(' OR ')})`];
    const quotedLocation = location ? this.quote(location) : '';
    if (quotedLocation) parts.push(quotedLocation);
    parts.push(OPEN_TO_WORK_CLAUSE);

    return parts.join(' ');
  }

  async search(dto: LinkedinSearchDto) {
    const query = this.buildQuery(dto.keyword, dto.location);
    const page = dto.page ?? 1;
    const cacheKey = `linkedin:${createHash('sha256').update(`${query.toLowerCase()}|${page}`).digest('hex')}`;

    const cached = await this.cache.getJson<LinkedinProfile[]>(cacheKey);
    if (cached) {
      return { query, page, count: cached.length, profiles: cached, cached: true };
    }

    const { results, provider } = await this.fetchResults(query, page);
    const profiles = results.filter((r) => /linkedin\.com\/in\//i.test(r.url)).map((r) => this.toProfile(r));

    await this.cache.setJson(cacheKey, profiles, CACHE_TTL_SEC);

    return { query, page, count: profiles.length, profiles, cached: false, provider };
  }

  /** Searlo's API first; the own Google browser when Searlo is off, failing, or paused after a failure. */
  private async fetchResults(query: string, page: number): Promise<{ results: GoogleResult[]; provider: SearchProvider }> {
    if (this.searlo.enabled && Date.now() >= this.searloPausedUntil) {
      try {
        return { results: await this.searlo.search(query, page), provider: 'searlo' };
      } catch (error) {
        this.searloPausedUntil = Date.now() + SEARLO_PAUSE_MS;
        this.logger.warn(`Searlo failed (${(error as Error).message}); using the Google browser for the next ${SEARLO_PAUSE_MS / 60000} min`);
      }
    }
    return { results: await this.googleBrowser.search(query, page), provider: 'google-browser' };
  }

  // LinkedIn titles look like "Name - Headline - Company | LinkedIn"
  private toProfile(result: GoogleResult): LinkedinProfile {
    const title = result.title.replace(/\s*[|\-–]\s*LinkedIn\s*$/i, '').trim();
    const [name, ...rest] = title.split(/\s+[-–]\s+/);
    return {
      name: name.trim(),
      headline: rest.length ? rest.join(' - ').trim() : null,
      // Country subdomains (ge.linkedin.com) all point at the same profile
      url: result.url.split('?')[0].replace(/^https?:\/\/[a-z]{2,3}\.linkedin\.com/i, 'https://www.linkedin.com'),
      snippet: result.snippet.replace(/\s*Read more$/i, ''),
    };
  }

  private quote(value: string): string {
    const cleaned = value.replace(/"/g, '').trim();
    return cleaned ? `"${cleaned}"` : '';
  }
}
