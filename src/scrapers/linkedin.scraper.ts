import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { JobData } from './jobs-ge.scraper';

export interface LinkedinScraperOptions {
  keywords?: string;
  location?: string;
  allGeorgia?: boolean;
  /** Countrywide scrape only: how far back to look (default 3 days) */
  postedWithinDays?: number;
  startPage?: number;
  maxPages?: number;
  delayBetweenRequests?: number;
  fetchDescriptions?: boolean;
  descriptionDelay?: number;
  descriptionLimit?: number;
}

export interface LinkedinScraperResult {
  jobs: JobData[];
  totalJobs: number;
  lastPage: number;
}

/** A parsed search card plus the key it is deduplicated by (LinkedIn job id, or the link) */
interface ParsedJobCard {
  key: string;
  job: Omit<JobData, 'page'>;
}

@Injectable()
export class LinkedinScraperService {
  private readonly logger = new Logger(LinkedinScraperService.name);

  private readonly searchBaseUrl = 'https://ge.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';
  private readonly jobDetailBaseUrl = 'https://ge.linkedin.com/jobs-guest/jobs/api/jobPosting';

  /**
   * LinkedIn's geo id for Georgia (the country). Without it a search falls back to the caller's IP
   * country, and `location=Georgia` resolves to the US state.
   */
  private readonly georgiaGeoId = '106315325';
  /** Guest searches stop returning results after start=990 */
  private readonly maxGuestPages = 100;
  private readonly pageSize = 10;

  private cookiesMap = new Map<string, string>();
  private requestCounter = 0;

  private readonly userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  ];

  private extractCookies(setCookieHeader: string[] | string | undefined) {
    if (!setCookieHeader) return;
    const rawCookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
    for (const raw of rawCookies) {
      const parts = raw.split(';')[0].trim();
      const eqIdx = parts.indexOf('=');
      if (eqIdx > 0) {
        const key = parts.slice(0, eqIdx).trim();
        const value = parts.slice(eqIdx + 1).trim();
        this.cookiesMap.set(key, value);
      }
    }
  }

  private getSessionCookieHeader(): string {
    if (this.cookiesMap.size === 0) return '';
    return Array.from(this.cookiesMap.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  private getRandomUserAgent(): string {
    const index = Math.floor(Math.random() * this.userAgents.length);
    return this.userAgents[index];
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Applies human-like randomized delays:
   * - Random delay on every request (e.g. 1,500ms - 2,500ms)
   * - After every 2 calls, inserts a longer human pause / breather (e.g. 4,500ms - 6,500ms)
   */
  private async applyHumanDelay(minMs = 1500, maxMs = 2500): Promise<void> {
    this.requestCounter++;
    if (this.requestCounter % 2 === 0) {
      const breatherMs = Math.floor(Math.random() * (6500 - 4500 + 1)) + 4500;
      this.logger.log(
        `[Human Delay] Completed 2 requests (Total requests: ${this.requestCounter}). Taking human pause for ${(breatherMs / 1000).toFixed(1)}s...`,
      );
      await this.sleep(breatherMs);
    } else {
      const delayMs = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
      this.logger.log(
        `[Human Delay] Waiting ${(delayMs / 1000).toFixed(1)}s before next request (Total requests: ${this.requestCounter})...`,
      );
      await this.sleep(delayMs);
    }
  }

  /**
   * Builds guest search params scoped to Georgia. A city name is passed as `location` (LinkedIn
   * resolves it); an empty location or one naming the country itself uses Georgia's geo id.
   */
  private buildSearchParams(keywords: string, location: string, start: number): URLSearchParams {
    const params = new URLSearchParams();
    params.append('start', start.toString());
    if (keywords.trim()) params.append('keywords', keywords.trim());
    const loc = location.trim();
    if (!loc || /^(georgia|საქართველო)$/i.test(loc)) {
      params.append('geoId', this.georgiaGeoId);
    } else {
      params.append('location', loc);
    }
    return params;
  }

  private async fetchSearchPage(params: URLSearchParams): Promise<string> {
    const requestUrl = `${this.searchBaseUrl}?${params.toString()}`;
    this.logger.log(`Fetching LinkedIn search: ${requestUrl}`);
    const response = await axios.get(requestUrl, {
      headers: {
        'User-Agent': this.getRandomUserAgent(),
        'Accept-Language': 'en-US,en;q=0.9,ka;q=0.8',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Dest': 'empty',
        ...(this.getSessionCookieHeader() ? { Cookie: this.getSessionCookieHeader() } : {}),
      },
      timeout: 15000,
    });
    this.extractCookies(response.headers?.['set-cookie']);
    return typeof response.data === 'string' ? response.data : '';
  }

  /**
   * Parses a guest search results page. `itemCount` counts every <li> (cards without a title
   * included) so callers can tell a full page from the last one.
   */
  private parseJobCards(html: string): { cards: ParsedJobCard[]; itemCount: number } {
    const $ = cheerio.load(html);
    const listItems = $('li');
    const cards: ParsedJobCard[] = [];

    listItems.each((_, el) => {
      const $el = $(el);

      const urn =
        $el.find('[data-entity-urn]').attr('data-entity-urn') ||
        $el.find('.base-card').attr('data-entity-urn') ||
        $el.attr('data-entity-urn') ||
        '';

      let jobId = '';
      const matchUrn = urn.match(/urn:li:jobPosting:(\d+)/);
      if (matchUrn) jobId = matchUrn[1];

      const rawLink =
        $el.find('a.base-card__full-link').attr('href') ||
        $el.find('a').attr('href') ||
        '';

      let cleanLink = rawLink ? rawLink.split('?')[0].trim() : '';
      if (!jobId && cleanLink) {
        const matchLink = cleanLink.match(/-(\d+)$/);
        if (matchLink) jobId = matchLink[1];
      }
      if (!cleanLink && jobId) {
        cleanLink = `https://www.linkedin.com/jobs/view/${jobId}`;
      }

      const vacancy =
        $el.find('.base-search-card__title').text().trim() ||
        $el.find('h3').text().trim();

      const key = jobId || cleanLink;
      if (!key || !vacancy) return;

      const company =
        $el.find('.base-search-card__subtitle').text().trim() ||
        $el.find('h4').text().trim() ||
        'LinkedIn Employer';

      const location =
        $el.find('.job-search-card__location').text().trim().replace(/^[\s\-\–\—\•\.\,\/]+/g, '').trim() ||
        'საქართველო';

      // Lazy-loaded card image; only real company logos (not LinkedIn's gray placeholder)
      const logoUrl = $el.find('img').first().attr('data-delayed-url') || '';
      const companyLogo =
        logoUrl.startsWith('https://media.licdn.com/') && logoUrl.includes('company-logo') ? logoUrl : undefined;

      const timeEl = $el.find('time');
      const publishDate = this.parsePublishDate(timeEl.attr('datetime'), timeEl.text().trim());

      cards.push({
        key,
        job: {
          vacancy,
          location,
          company,
          link: cleanLink,
          publishDate,
          deadline: this.calculateDeadline(publishDate),
          description: undefined,
          companyLogo,
        },
      });
    });

    return { cards, itemCount: listItems.length };
  }

  /**
   * Scrapes LinkedIn jobs for Georgia with pagination, deduplication, and optional full descriptions.
   */
  async scrapeJobs(options: LinkedinScraperOptions = {}): Promise<LinkedinScraperResult> {
    if (options.allGeorgia) {
      return await this.scrapeAllGeorgiaJobs(options);
    }

    this.requestCounter = 0;
    this.cookiesMap.clear();

    const {
      keywords = '',
      location = '',
      startPage = 1,
      maxPages = 50,
      fetchDescriptions = false,
      descriptionLimit = undefined,
    } = options;

    this.logger.log(
      `Starting LinkedIn scrape: keywords="${keywords}", location="${location || 'Georgia (All)'}", startPage=${startPage}, maxPages=${maxPages}, fetchDescriptions=${fetchDescriptions}`,
    );

    const allJobs: JobData[] = [];
    const seenJobIds = new Set<string>();
    let currentPage = startPage;
    let consecutiveEmptyPages = 0;
    let consecutive429 = 0;

    while (currentPage <= startPage + maxPages - 1) {
      const params = this.buildSearchParams(keywords, location, (currentPage - 1) * this.pageSize);

      try {
        const html = await this.fetchSearchPage(params);
        consecutive429 = 0;

        if (html.trim() === '') {
          this.logger.warn(`LinkedIn page ${currentPage} returned empty response.`);
          consecutiveEmptyPages++;
          if (consecutiveEmptyPages >= 2) break;
          currentPage++;
          await this.applyHumanDelay();
          continue;
        }

        const { cards, itemCount } = this.parseJobCards(html);
        if (itemCount === 0) {
          this.logger.log(`No job cards found on page ${currentPage}. End of results reached.`);
          break;
        }

        consecutiveEmptyPages = 0;
        let pageJobsCount = 0;
        for (const { key, job } of cards) {
          if (seenJobIds.has(key)) continue;
          seenJobIds.add(key);
          allJobs.push({ ...job, page: currentPage });
          pageJobsCount++;
        }

        this.logger.log(`Page ${currentPage}: parsed ${pageJobsCount} jobs (Total collected: ${allJobs.length})`);

        if (itemCount < this.pageSize) {
          this.logger.log(`Page ${currentPage} returned fewer than ${this.pageSize} items. Stopping pagination.`);
          break;
        }

        currentPage++;
        await this.applyHumanDelay();
      } catch (error: any) {
        if (error.response?.status === 429) {
          consecutive429++;
          const backoff = consecutive429 * 6000 + Math.floor(Math.random() * 2000);
          this.logger.warn(`429 Rate limit on page ${currentPage}. Backing off for ${(backoff / 1000).toFixed(1)}s before continuing...`);
          await this.sleep(backoff);
          if (consecutive429 >= 2) {
            this.logger.warn(`Repeated 429 encountered. Stopping single query.`);
            break;
          }
        } else {
          this.logger.error(`Error scraping LinkedIn page ${currentPage}: ${error.message}`);
          currentPage++;
        }
      }
    }

    if (fetchDescriptions && allJobs.length > 0) {
      this.logger.log(`Fetching job descriptions sequentially with rate-limit protection...`);
      await this.enrichJobsWithDescriptions(allJobs, descriptionLimit);
    }

    this.logger.log(`LinkedIn scrape finished. Total unique jobs found: ${allJobs.length}`);

    return {
      jobs: allJobs,
      totalJobs: allJobs.length,
      lastPage: currentPage - 1,
    };
  }

  /**
   * Scrapes every vacancy in Georgia posted within the last `postedWithinDays` days.
   * Results are requested newest first, so LinkedIn's ~1,000-result cap on guest searches only cuts
   * off the oldest postings. (Relevance-sorted searches buried fresh postings past the page limit.)
   * The 3-day default (~150 jobs) is meant for the daily run and survives a couple of missed runs;
   * Georgia gets ~50 postings a day, so windows past ~20 days hit the cap and rate limits.
   */
  async scrapeAllGeorgiaJobs(options: LinkedinScraperOptions = {}): Promise<LinkedinScraperResult> {
    const {
      keywords = '',
      postedWithinDays = 3,
      fetchDescriptions = false,
      descriptionLimit = undefined,
    } = options;

    this.requestCounter = 0;
    this.cookiesMap.clear();

    this.logger.log(`Starting LinkedIn scrape of Georgia: postings from the last ${postedWithinDays} days, newest first...`);

    const allJobsMap = new Map<string, JobData>();
    let page = 1;
    let consecutive429 = 0;
    let consecutiveErrors = 0;
    let consecutiveZeroNew = 0;

    while (page <= this.maxGuestPages) {
      const params = this.buildSearchParams(keywords, '', (page - 1) * this.pageSize);
      params.append('f_TPR', `r${postedWithinDays * 86400}`);
      params.append('sortBy', 'DD');

      try {
        const { cards, itemCount } = this.parseJobCards(await this.fetchSearchPage(params));
        consecutive429 = 0;
        consecutiveErrors = 0;

        let newInPage = 0;
        for (const { key, job } of cards) {
          if (allJobsMap.has(key)) continue;
          allJobsMap.set(key, { ...job, page });
          newInPage++;
        }

        if (page % 5 === 0 || itemCount < this.pageSize || newInPage === 0) {
          this.logger.log(`Page ${page}: +${newInPage} new jobs. Total unique so far: ${allJobsMap.size}`);
        }

        if (itemCount < this.pageSize) {
          this.logger.log(`Page ${page} returned ${itemCount} items (< ${this.pageSize}). Scrape complete.`);
          break;
        }

        // A date-sorted search only repeats itself when LinkedIn stops paginating properly
        consecutiveZeroNew = newInPage === 0 ? consecutiveZeroNew + 1 : 0;
        if (consecutiveZeroNew >= 3) {
          this.logger.warn(`No new jobs across 3 consecutive pages. Stopping at page ${page}.`);
          break;
        }

        page++;
        await this.applyHumanDelay();
      } catch (err: any) {
        if (err.response?.status === 429) {
          consecutive429++;
          if (consecutive429 >= 4) {
            this.logger.warn(`Repeated 429 on page ${page}. Stopping with ${allJobsMap.size} jobs collected.`);
            break;
          }
          const backoff = consecutive429 * 15000 + Math.floor(Math.random() * 3000);
          this.logger.warn(`429 Rate limit on page ${page}. Backing off for ${(backoff / 1000).toFixed(1)}s before retrying...`);
          await this.sleep(backoff);
        } else {
          consecutiveErrors++;
          this.logger.error(`Page ${page} failed: ${err.message}`);
          if (consecutiveErrors >= 3) break;
          page++;
          await this.applyHumanDelay();
        }
      }
    }

    const allJobs = Array.from(allJobsMap.values());
    this.logger.log(`LinkedIn scrape of Georgia completed. Found ${allJobs.length} unique vacancies.`);

    if (fetchDescriptions && allJobs.length > 0) {
      const descLimit = descriptionLimit ?? 25;
      this.logger.log(`Fetching descriptions for up to ${descLimit} jobs with rate-limit protection...`);
      await this.enrichJobsWithDescriptions(allJobs, descLimit);
    }

    return {
      jobs: allJobs,
      totalJobs: allJobs.length,
      lastPage: page,
    };
  }

  /**
   * Convenience method to scrape all jobs for Georgia
   */
  async scrapeAllJobs(options: LinkedinScraperOptions = {}): Promise<LinkedinScraperResult> {
    return await this.scrapeAllGeorgiaJobs({
      fetchDescriptions: options.fetchDescriptions ?? false,
      ...options,
    });
  }

  /**
   * Fetches job descriptions sequentially with delays and jitter to prevent 429 rate limits
   */
  private async enrichJobsWithDescriptions(
    jobs: JobData[],
    limit?: number,
  ): Promise<void> {
    const jobsToEnrich = limit && limit > 0 ? jobs.slice(0, limit) : jobs;
    this.logger.log(`Enriching ${jobsToEnrich.length} job descriptions with human delays...`);
    for (let i = 0; i < jobsToEnrich.length; i++) {
      const job = jobsToEnrich[i];
      const jobId = this.extractJobIdFromLink(job.link);
      if (jobId) {
        try {
          job.description = await this.fetchJobDescription(jobId);
          this.logger.log(`[${i + 1}/${jobsToEnrich.length}] Enriched description for: ${job.vacancy}`);
        } catch (err: any) {
          this.logger.warn(`Could not fetch description for job ${jobId}: ${err.message}`);
          job.description = undefined; // Don't throw, gracefully continue
        }
      }
      if (i < jobsToEnrich.length - 1) {
        await this.applyHumanDelay(1800, 2800);
      }
    }
  }

  /**
   * Fetches the full job description from LinkedIn's guest jobPosting endpoint with retry & backoff
   */
  async fetchJobDescription(jobId: string, retryCount = 0): Promise<string> {
    const url = `${this.jobDetailBaseUrl}/${jobId}`;
    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': this.getRandomUserAgent(),
          'Accept-Language': 'en-US,en;q=0.9,ka;q=0.8',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Referer': 'https://ge.linkedin.com/jobs/search',
          ...(this.getSessionCookieHeader() ? { Cookie: this.getSessionCookieHeader() } : {}),
        },
        timeout: 10000,
      });

      this.extractCookies(response.headers?.['set-cookie']);

      const $ = cheerio.load(response.data);
      const rawDesc =
        $('.show-more-less-html__markup').html() ||
        $('.decorated-job-posting__details').html() ||
        $('.description__text').html() ||
        '';

      const criteriaItems: string[] = [];
      $('.description__job-criteria-item').each((_, el) => {
        const header = $(el).find('.description__job-criteria-subheader').text().trim();
        const val = $(el).find('.description__job-criteria-text').text().trim();
        if (header && val) {
          criteriaItems.push(`${header}: ${val}`);
        }
      });

      let cleaned = this.cleanHtmlDescription(rawDesc);
      if (criteriaItems.length > 0) {
        cleaned = `${criteriaItems.join(' | ')}\n\n${cleaned}`;
      }

      return cleaned.trim();
    } catch (error: any) {
      if (error.response?.status === 429 && retryCount < 2) {
        const backoffMs = (retryCount + 1) * 6000 + Math.floor(Math.random() * 2000);
        this.logger.warn(`Rate limit 429 on job ${jobId}. Backing off for ${(backoffMs / 1000).toFixed(1)}s before retry ${retryCount + 1}...`);
        await this.sleep(backoffMs);
        return await this.fetchJobDescription(jobId, retryCount + 1);
      }
      throw error;
    }
  }

  private extractJobIdFromLink(link: string): string | null {
    if (!link) return null;
    const match = link.match(/-(\d+)(?:\?|$)/) || link.match(/\/(\d+)(?:\?|$)/);
    return match ? match[1] : null;
  }

  /**
   * Normalizes dates into DD/MM/YYYY
   */
  private parsePublishDate(datetimeAttr?: string, timeText?: string): string {
    const today = new Date();

    if (datetimeAttr && datetimeAttr.trim()) {
      const cleaned = datetimeAttr.trim();
      const matchIso = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (matchIso) {
        return `${matchIso[3]}/${matchIso[2]}/${matchIso[1]}`;
      }
      const parsed = new Date(cleaned);
      if (!isNaN(parsed.getTime())) {
        return this.formatDateObj(parsed);
      }
    }

    if (timeText && timeText.trim()) {
      const text = timeText.toLowerCase().trim();
      if (text.includes('just now') || text.includes('today') || text.includes('hour') || text.includes('minute')) {
        return this.formatDateObj(today);
      }
      const daysMatch = text.match(/(\d+)\s+day/);
      if (daysMatch) {
        const d = new Date(today);
        d.setDate(d.getDate() - parseInt(daysMatch[1], 10));
        return this.formatDateObj(d);
      }
      const weeksMatch = text.match(/(\d+)\s+week/);
      if (weeksMatch) {
        const d = new Date(today);
        d.setDate(d.getDate() - parseInt(weeksMatch[1], 10) * 7);
        return this.formatDateObj(d);
      }
      const monthsMatch = text.match(/(\d+)\s+month/);
      if (monthsMatch) {
        const d = new Date(today);
        d.setMonth(d.getMonth() - parseInt(monthsMatch[1], 10));
        return this.formatDateObj(d);
      }
    }

    return this.formatDateObj(today);
  }

  private calculateDeadline(publishDateStr: string): string {
    if (!publishDateStr) return '';
    const parts = publishDateStr.split('/');
    if (parts.length === 3) {
      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const year = parseInt(parts[2], 10);
      const pubDate = new Date(year, month, day);
      if (!isNaN(pubDate.getTime())) {
        const deadlineDate = new Date(pubDate);
        deadlineDate.setMonth(deadlineDate.getMonth() + 1);
        return this.formatDateObj(deadlineDate);
      }
    }
    return '';
  }

  private formatDateObj(date: Date): string {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }

  private cleanHtmlDescription(html: string): string {
    if (!html || typeof html !== 'string') return '';

    let text = html;

    for (let pass = 0; pass < 3; pass++) {
      const prev = text;
      text = text.replace(/&amp;/gi, '&');
      text = text.replace(/&lt;/gi, '<');
      text = text.replace(/&gt;/gi, '>');
      text = text.replace(/&quot;/gi, '"');
      text = text.replace(/&#39;/gi, "'");
      text = text.replace(/&apos;/gi, "'");
      text = text.replace(/&nbsp;/gi, ' ');
      if (text === prev) break;
    }

    text = text.replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));
    text = text.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

    const entities: Record<string, string> = {
      '&nbsp;': ' ',
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&#39;': "'",
      '&apos;': "'",
      '&bull;': '•',
      '&ndash;': '-',
      '&mdash;': '—',
    };
    text = text.replace(/&[a-z0-9]+;/gi, (match) => entities[match.toLowerCase()] || match);

    text = text.replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n');
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<[^>]+>/g, '');

    return text
      .split('\n')
      .map((line) => line.trim())
      .filter((line, idx, arr) => line.length > 0 || (idx > 0 && arr[idx - 1].length > 0))
      .join('\n')
      .trim();
  }
}
