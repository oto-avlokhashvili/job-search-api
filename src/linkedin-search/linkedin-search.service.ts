import { Injectable } from '@nestjs/common';
import { LinkedinSearchDto } from './dto/linkedin-search.dto';
import { GoogleBrowserService, GoogleResult } from './google-browser.service';

export interface LinkedinProfile {
  name: string;
  headline: string | null;
  url: string;
  snippet: string;
}

const OPEN_TO_WORK_CLAUSE = '("open to work" OR "#opentowork" OR "looking for new opportunities")';
// Every Google hit risks a CAPTCHA, so identical searches are answered from memory.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

@Injectable()
export class LinkedinSearchService {
  private readonly cache = new Map<string, { expiresAt: number; profiles: LinkedinProfile[] }>();

  constructor(private readonly googleBrowser: GoogleBrowserService) {}

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
    const cacheKey = `${query.toLowerCase()}|${page}`;

    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { query, page, count: cached.profiles.length, profiles: cached.profiles, cached: true };
    }

    const results = await this.googleBrowser.search(query, page);
    const profiles = results.filter((r) => /linkedin\.com\/in\//i.test(r.url)).map((r) => this.toProfile(r));

    if (this.cache.size >= CACHE_MAX_ENTRIES) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, profiles });

    return { query, page, count: profiles.length, profiles, cached: false };
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
