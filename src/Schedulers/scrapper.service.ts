import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { JobService } from 'src/job/job.service';

export interface JobData {
  vacancy: string;
  company: string;
  link: string;
  publishDate: string;
  deadline: string;
  page: number;
}

export interface ScraperOptions {
  maxJobs?: number;
  delayBetweenRequests?: number;
  maxPages?: number;
}

export interface ScraperResult {
  jobs: JobData[];
  totalJobs: number;
  lastPage: number;
}

@Injectable()
export class ScraperService {
  constructor(@Inject(forwardRef(() => JobService))
    private readonly jobService: JobService,){}
  private readonly logger = new Logger(ScraperService.name);
  private readonly baseUrl = 'https://www.jobs.ge';

  // Georgian month mapping
  private readonly georgianMonths: Record<string, string> = {
    'იანვარი': '01',
    'თებერვალი': '02',
    'მარტი': '03',
    'აპრილი': '04',
    'მაისი': '05',
    'ივნისი': '06',
    'ივლისი': '07',
    'აგვისტო': '08',
    'სექტემბერი': '09',
    'ოქტომბერი': '10',
    'ნოემბერი': '11',
    'დეკემბერი': '12',
  };

  /**
   * Convert Georgian date format to DD/MM/YYYY
   * Example: "16 ოქტომბერი" -> "16/10/2025"
   */
  private convertGeorgianDate(georgianDate: string): string {
    if (!georgianDate || georgianDate.trim() === '') {
      return '';
    }

    try {
      const parts = georgianDate.trim().split(' ');
      
      if (parts.length < 2) {
        return georgianDate; // Return as-is if format is unexpected
      }

      const day = parts[0].padStart(2, '0');
      const monthName = parts[1];
      const month = this.georgianMonths[monthName];

      if (!month) {
        this.logger.warn(`Unknown Georgian month: ${monthName}`);
        return georgianDate;
      }

      // Get current year or extract if present
      const currentYear = new Date().getFullYear();
      const year = parts[2] ? parts[2] : currentYear.toString();

      return `${day}/${month}/${year}`;
    } catch (error) {
      this.logger.error(`Error converting date: ${georgianDate}`, error);
      return georgianDate;
    }
  }

  /**
   * Main scraper method
   */
  async scrapeJobs(
    query: string = '',
    startPage: number = 1,
    options: ScraperOptions = {},
  ): Promise<ScraperResult> {
    const {
      maxJobs = 300,
      delayBetweenRequests = 0,
      maxPages = 999,
    } = options;

    const allJobs: JobData[] = [];
    let currentPage = startPage;
    let consecutiveEmptyPages = 0;

    try {
      this.logger.log(`Starting scraper with query: "${query}"`);
      this.logger.log(`Will stop when: no jobs found OR total jobs < ${maxJobs}`);
      this.logger.log('============================================================');

      while (currentPage <= maxPages) {
        const url = `https://jobs.ge/?page=${currentPage}&q=${encodeURIComponent(query)}&cid=0&lid=0&jid=0&in_title=0&has_salary=0&is_ge=0&for_scroll=yes`;

        this.logger.log(`[Page ${currentPage}] Fetching...`);

        if (currentPage > startPage) {
          this.logger.log(`Waiting ${delayBetweenRequests / 1000} seconds...`);
          await this.delay(delayBetweenRequests);
        }

        const response = await axios.get(url, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            Accept:
              'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            Referer: 'https://jobs.ge/',
          },
          timeout: 15000,
        });

        const $ = cheerio.load(response.data);
        let jobsOnPage = 0;

        // Debug: Log how many table rows found
        const totalRows = $('table tr').length;
        this.logger.debug(`Found ${totalRows} table rows on page ${currentPage}`);

        // Try different selectors if table doesn't work
        if (totalRows === 0) {
          this.logger.warn('No table rows found. Trying alternative selectors...');
          const links = $('a.vip').length;
          this.logger.debug(`Found ${links} job links with class "vip"`);
        }

        $('table tr').each((i, elem) => {
          const cells = $(elem).find('td');

          // Debug: Log cell count for first few rows
          if (i < 3) {
            this.logger.debug(`Row ${i}: Found ${cells.length} cells`);
            if (cells.length > 0) {
              this.logger.debug(`Row ${i} HTML: ${$(elem).html()?.substring(0, 200)}...`);
            }
          }

          if (cells.length < 6) return;

          const jobTitleEl = $(cells[1]).find('a.vip').first();
          const companyEl = $(cells[3]).find('a').first();
          const publishEl = $(cells[4]);
          const deadlineEl = $(cells[5]);

          const vacancy = jobTitleEl.text().trim();
          const jobLink = jobTitleEl.attr('href');
          const company = companyEl.text().trim();
          const publishDateRaw = publishEl.text().trim();
          const deadlineRaw = deadlineEl.text().trim();

          // Convert dates from Georgian to DD/MM/YYYY format
          const publishDate = this.convertGeorgianDate(publishDateRaw);
          const deadline = this.convertGeorgianDate(deadlineRaw);

          const link = jobLink
            ? jobLink.startsWith('http')
              ? jobLink
              : this.baseUrl + jobLink
            : '';

          if (vacancy && link) {
            const q = query.trim().toLowerCase();
            const vacancyLower = vacancy.toLowerCase();

            if (!q || vacancyLower.includes(q)) {
              allJobs.push({
                vacancy,
                company: company || 'კომპანია',
                link,
                publishDate,
                deadline,
                page: currentPage,
              });
              jobsOnPage++;
            }
          }
        });

        this.logger.log(`Found ${jobsOnPage} jobs on page ${currentPage}`);
        this.logger.log(`Total jobs collected: ${allJobs.length}`);

        if (jobsOnPage === 0) {
          consecutiveEmptyPages++;
          this.logger.log(
            `Empty page detected (${consecutiveEmptyPages} consecutive)`,
          );

          if (consecutiveEmptyPages >= 2) {
            this.logger.log('\nFound 2 consecutive empty pages - stopping');
            break;
          }
        } else {
          consecutiveEmptyPages = 0;
        }

        if (
          allJobs.length > 0 &&
          allJobs.length < maxJobs &&
          jobsOnPage === 0
        ) {
          this.logger.log(
            `\nTotal jobs (${allJobs.length}) < ${maxJobs} and no more jobs found - stopping`,
          );
          break;
        }

        currentPage++;
      }

      this.logger.log('\n============================================================');
      this.logger.log('SCRAPING COMPLETE');
      this.logger.log('============================================================');
      this.logger.log(`Last page checked: ${currentPage}`);
      this.logger.log(`Total jobs found: ${allJobs.length}`);
      this.logger.log(
        `Estimated time: ~${((currentPage - startPage) * delayBetweenRequests) / 1000} seconds`,
      );

      // Log all jobs to console
      if (allJobs.length > 0) {
        this.logger.log('\n📋 SCRAPED JOBS DATA:');
        this.logger.log('============================================================');
        console.log(JSON.stringify(allJobs, null, 2));
        console.log(allJobs.length);
        /* allJobs.forEach((item) => {
            this.jobService.create(item)
        }) */
        this.jobService.insertMany(allJobs);
        this.logger.log('============================================================');
      } else {
        this.logger.log('\n❌ No jobs found');
      }

      return {
        jobs: allJobs,
        totalJobs: allJobs.length,
        lastPage: currentPage,
      };
    } catch (error) {
      this.logger.error('\n❌ ERROR OCCURRED:');

      if (error.code === 'ECONNABORTED') {
        this.logger.error('Request timeout - server took too long to respond');
      } else if (error.response) {
        this.logger.error(
          `Server error: ${error.response.status} - ${error.response.statusText}`,
        );
      } else if (error.request) {
        this.logger.error('No response from server - network issue');
      } else {
        this.logger.error(`Error: ${error.message}`);
      }

      // Log partial results if any
      if (allJobs.length > 0) {
        this.logger.log(`\n📋 PARTIAL RESULTS (${allJobs.length} jobs):`);
        console.log(JSON.stringify(allJobs, null, 2));
      }

      return {
        jobs: allJobs,
        totalJobs: allJobs.length,
        lastPage: currentPage,
      };
    }
  }

  /**
   * Helper method to add delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}