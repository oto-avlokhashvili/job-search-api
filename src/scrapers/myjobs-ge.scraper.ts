import { Injectable, Logger } from '@nestjs/common';
import { JobData } from './jobs-ge.scraper';

export interface MyjobsScraperOptions {
  delayBetweenRequests?: number;
  maxPages?: number;
  pageSize?: number;
}

export interface MyjobsScraperResult {
  jobs: JobData[];
  totalJobs: number;
  totalAvailable: number;
  lastPage: number;
}

@Injectable()
export class MyjobsGeScraperService {
  private readonly logger = new Logger(MyjobsGeScraperService.name);
  private readonly apiUrl = 'https://api.myjobs.ge/api/ka/public/vacancies/v2';

  /**
   * Scrapes every single job listing across all pages for myjobs.ge
   */
  async scrapeAllJobs(options: MyjobsScraperOptions = {}): Promise<MyjobsScraperResult> {
    const {
      delayBetweenRequests = 250,
      maxPages = 9999,
      pageSize = 50,
    } = options;

    this.logger.log('!!! Starting FULL Scrape for myjobs.ge !!!');

    const allJobs: JobData[] = [];
    let currentPage = 1;
    let keepScraping = true;
    let totalAvailable = 0;

    while (keepScraping) {
      if (currentPage > maxPages) {
        this.logger.log(`Reached max pages limit of ${maxPages}. Stopping.`);
        break;
      }

      this.logger.log(`Scraping myjobs.ge page ${currentPage} (count: ${pageSize})...`);

      try {
        const url = `${this.apiUrl}?page=${currentPage}&count=${pageSize}`;
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Accept': 'application/json, text/plain, */*',
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Origin': 'https://myjobs.ge',
            'Referer': 'https://myjobs.ge/',
          },
        });

        if (!response.ok) {
          this.logger.error(
            `myjobs.ge API rejected request at page ${currentPage} with status ${response.status}. Stopping.`,
          );
          break;
        }

        const payload = await response.json();
        const items = payload?.data || [];
        if (payload?.total) {
          totalAvailable = payload.total;
        }

        if (!Array.isArray(items) || items.length === 0) {
          this.logger.log(`Reached the end of myjobs.ge! Page ${currentPage} returned 0 items.`);
          keepScraping = false;
          break;
        }

        items.forEach((item: any) => {
          const vacancy = item.title || item.name || 'N/A';
          const company =
            item.company?.brand_name ||
            item.company?.title ||
            item.recruiter_company_name ||
            'კომპანია';

          const rawLocation =
            item.country?.city?.title ||
            item.company?.city_title ||
            item.country?.title ||
            'თბილისი';

          let location = rawLocation.replace(/^[\s\-\–\—\•\.\,\/]+/g, '').trim();
          if (!location) {
            location = 'თბილისი';
          }

          const rawPublishDate = item.created_at || item.published_at || '';
          const rawDeadline = item.deadline || item.end_date || item.expired_at || '';

          const rawDescription = item.description || '';
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

          const id = item.id;
          if (id) {
            const link = `https://myjobs.ge/ka/vacancies/${id}`;
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

        if (payload?.last_page && currentPage >= payload.last_page) {
          this.logger.log(`Reached last page (${payload.last_page}) reported by API.`);
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
      } catch (error: any) {
        this.logger.error(`Error scraping myjobs.ge page ${currentPage}: ${error.message}`);
        break;
      }
    }

    const lastPage = currentPage;
    this.logger.log(
      `!!! Finished scraping myjobs.ge. Total jobs collected: ${allJobs.length} out of ${totalAvailable} total available !!!`,
    );

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
   * - Unescapes multi-encoded HTML entities repeatedly
   * - Decodes numeric and hex HTML entities
   * - Decodes standard named entities
   * - Converts block elements to clean newlines
   * - Strips remaining HTML tags and normalizes whitespace
   */
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

    text = text.replace(/&#(\d+);/g, (_, dec) => {
      return String.fromCharCode(parseInt(dec, 10));
    });

    text = text.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      return String.fromCharCode(parseInt(hex, 16));
    });

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
