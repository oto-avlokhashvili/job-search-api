import { Injectable, Logger } from '@nestjs/common';
import { JobData } from './jobs-ge.scraper';


export interface AworkScraperOptions {
  delayBetweenRequests?: number;
  maxPages?: number;
  pageSize?: number;
}

export interface AworkScraperResult {
  jobs: JobData[];
  totalJobs: number;
  totalAvailable: number;
  lastPage: number;
}

@Injectable()
export class AworkGeScraperService {
  private readonly logger = new Logger(AworkGeScraperService.name);
  private readonly apiUrl = 'https://server.prod.awork.ge/v1/user/vacancies/filter';

  /**
   * Scrapes every single job listing across all pages for awork.ge
   */
  async scrapeAllJobs(options: AworkScraperOptions = {}): Promise<AworkScraperResult> {
    const {
      delayBetweenRequests = 250,
      maxPages = 9999,
      pageSize = 50,
    } = options;

    this.logger.log('!!! Starting FULL Scrape for awork.ge !!!');

    const allJobs: JobData[] = [];
    let currentPage = 1;
    let keepScraping = true;
    let totalAvailable = 0;

    while (keepScraping) {
      if (currentPage > maxPages) {
        this.logger.log(`Reached max pages limit of ${maxPages}. Stopping.`);
        break;
      }

      this.logger.log(`Scraping awork.ge page ${currentPage} (per_page: ${pageSize})...`);

      try {
        const response = await fetch(this.apiUrl, {
          method: 'POST',
          headers: {
            'Accept': 'application/json, text/plain, */*',
            'Content-Type': 'application/json',
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Origin': 'https://awork.ge',
            'Referer': 'https://awork.ge/',
          },
          body: JSON.stringify({
            find: {},
            page: currentPage,
            per_page: pageSize,
          }),
        });

        if (!response.ok) {
          this.logger.error(
            `awork.ge API rejected request at page ${currentPage} with status ${response.status}. Stopping.`,
          );
          break;
        }

        const payload = await response.json();
        const items = payload?.items || [];
        if (payload?.total) {
          totalAvailable = payload.total;
        }

        if (!Array.isArray(items) || items.length === 0) {
          this.logger.log(`Reached the end of awork.ge! Page ${currentPage} returned 0 items.`);
          keepScraping = false;
          break;
        }

        items.forEach((item: any) => {
          const vacancy = item.name || 'N/A';
          const company = item.business?.name || 'კომპანია';
          const rawLocation =
            item.address?.street_city ||
            item.address?.city ||
            (Array.isArray(item.regions) && item.regions.length > 0
              ? item.regions.map((r: any) => r.name).join(', ')
              : 'თბილისი');

          let location = rawLocation.replace(/^[\s\-\–\—\•\.\,\/]+/g, '').trim();
          if (!location) {
            location = 'თბილისი';
          }

          const rawPublishDate = item.publish_date || item.start_date || '';
          const rawDeadline = item.end_date || item.deadline || '';
          
          // Prioritize text_only, then combine/fallback other info fields
          const rawDescription =
            item.info?.text_only ||
            item.info?.about_role ||
            [item.info?.responsibilities, item.info?.requirements, item.info?.additional]
              .filter(Boolean)
              .join('\n\n') ||
            item.description ||
            '';

          const description = this.cleanHtmlDescription(rawDescription);

          const publishDate = this.formatDate(rawPublishDate);
          let deadline = this.formatDate(rawDeadline);

          if (!deadline || deadline.trim() === '') {
            if (rawPublishDate) {
              const pubDate = new Date(rawPublishDate);
              if (!isNaN(pubDate.getTime())) {
                const deadlineDateObj = new Date(pubDate);
                deadlineDateObj.setMonth(deadlineDateObj.getMonth() + 1);
                deadline = this.formatDate(deadlineDateObj.toISOString());
              }
            }
          }

          const uid = item.uid || item.short_id;
          if (uid) {
            const link = `https://awork.ge/user/vacancy/${uid}`;
            allJobs.push({
              vacancy: vacancy.trim(),
              location: location.trim(),
              company: company.trim(),
              link,
              publishDate: publishDate.trim(),
              deadline: deadline.trim(),
              page: currentPage,
              description,
            });
          }
        });

        this.logger.log(
          `Page ${currentPage} processed. Scraped so far: ${allJobs.length} / ${totalAvailable || 'unknown'} total jobs`,
        );

        if (totalAvailable > 0 && allJobs.length >= totalAvailable) {
          this.logger.log(`Reached total available count of ${totalAvailable} jobs. Scraping complete.`);
          keepScraping = false;
          break;
        }

        if (items.length < pageSize) {
          this.logger.log(`Page ${currentPage} returned ${items.length} items (< ${pageSize}). Final page reached.`);
          keepScraping = false;
          break;
        }

        currentPage++;
        if (delayBetweenRequests > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayBetweenRequests));
        }
      } catch (error) {
        this.logger.error(`Error scraping awork.ge page ${currentPage}: ${error.message}`);
        break;
      }
    }

    const lastPage = currentPage;
    this.logger.log(`!!! Finished scraping awork.ge. Total jobs collected: ${allJobs.length} out of ${totalAvailable} total available !!!`);

    return {
      jobs: allJobs,
      totalJobs: allJobs.length,
      totalAvailable: totalAvailable || allJobs.length,
      lastPage,
    };
  }

  private formatDate(dateStr: string): string {
    if (!dateStr || dateStr.trim() === '') return '';
    try {
      const cleaned = dateStr.trim();
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(cleaned)) {
        return cleaned;
      }
      const matchIso = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})(?:T|\s|$)/);
      if (matchIso) {
        return `${matchIso[3]}/${matchIso[2]}/${matchIso[1]}`;
      }
      const date = new Date(cleaned);
      if (isNaN(date.getTime())) return cleaned;

      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();

      return `${day}/${month}/${year}`;
    } catch {
      return dateStr;
    }
  }

  /**
   * Cleans raw HTML text from vacancy descriptions:
   * - Unescapes multi-encoded HTML entities repeatedly (&amp;#4313; -> &#4313; -> კ)
   * - Decodes numeric and hex HTML entities
   * - Decodes standard named entities (&nbsp;, &amp;, &quot;, &lt;, &gt;, etc.)
   * - Converts block elements (<p>, <div>, <br>, <li>, <tr>, <h1..h6>) to clean newlines
   * - Strips any remaining HTML tags and normalizes whitespace
   */
  private cleanHtmlDescription(html: string): string {
    if (!html || typeof html !== 'string') return '';

    let text = html;

    // Unescape standard encoded entities repeatedly (handles nested/double-encoded entities like &amp;#4313;)
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

    // Decode numeric HTML entities (e.g. &#4313; -> კ)
    text = text.replace(/&#(\d+);/g, (_, dec) => {
      return String.fromCharCode(parseInt(dec, 10));
    });

    // Decode hex HTML entities (e.g. &#x10D3; -> დ)
    text = text.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      return String.fromCharCode(parseInt(hex, 16));
    });

    // Decode common named entities
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

    // Replace block element tags with newlines
    text = text.replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n');
    text = text.replace(/<br\s*\/?>/gi, '\n');

    // Strip all remaining HTML tags
    text = text.replace(/<[^>]+>/g, '');

    // Normalize whitespace: trim spaces per line, collapse multiple blank lines
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter((line, idx, arr) => line.length > 0 || (idx > 0 && arr[idx - 1].length > 0))
      .join('\n')
      .trim();
  }
}
