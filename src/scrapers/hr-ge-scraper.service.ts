import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { JobData } from './jobs-ge.scraper';

export interface HrScraperOptions {
  delayBetweenRequests?: number;
  fetchDescriptions?: boolean;
  descriptionDelay?: number;
  descriptionBatchSize?: number;
  maxPages?: number;
}

@Injectable()
export class HrGeScraperService {
  private readonly logger = new Logger(HrGeScraperService.name);

  /**
   * Scrapes every single job listing across all pages for a given tenant
   * @param tenantId 1 = hr.ge, 2 = cv.ge, 4 = doctor.ge, 5 = chefs.ge
   */
  async scrapeAllJobs(
    tenantId: number = 1,
    options: HrScraperOptions = {},
  ): Promise<JobData[]> {
    const {
      delayBetweenRequests = 250,
      fetchDescriptions = false,
      descriptionDelay = 1500,
      descriptionBatchSize = 10,
      maxPages = 9999,
    } = options;
    const domainMap: Record<number, string> = {
      1: 'hr.ge', 2: 'cv.ge', 4: 'doctor.ge', 5: 'chefs.ge'
    };
    const domain = domainMap[tenantId] || 'hr.ge';
    
    this.logger.log(`!!! Starting FULL Scrape for ${domain} using POST search API !!!`);

    const allJobs: JobData[] = [];
    const limit = 100;
    let startOffset = 0;
    let keepScraping = true;
    let pageCount = 1;

    while (keepScraping) {
      if (pageCount > maxPages) {
        this.logger.log(`Reached max pages limit of ${maxPages}. Stopping.`);
        break;
      }
      this.logger.log(`Scraping page ${pageCount} (Offset: ${startOffset}, Limit: ${limit})...`);
      
      const cacheBuster = Math.floor(1000000000 + Math.random() * 9000000000);
      const url = `https://api.p.hr.ge/public-portal/tenant/${tenantId}/api/v3/announcement-search?__cb=${cacheBuster}`;

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Accept': 'application/json, text/plain, */*',
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
            'Origin': `https://${domain}`,
            'Referer': `https://${domain}/`
          },
          body: JSON.stringify({
            CategoryIds: [],
            WorkExperience: {
              from: null,
              to: null
            },
            WithoutWorkExperience: false,
            AnyExperience: false,
            OnlySelectedSalary: false,
            Start: startOffset,
            Limit: limit,
            IsWorkFromHome: false
          })
        });

        if (!response.ok) {
          this.logger.error(`API rejected request at offset ${startOffset} with status ${response.status}. Stopping execution.`);
          break;
        }

        const payload = await response.json();
        const items = payload?.data?.announcements?.items || [];

        // Stop immediately if the page returns nothing 
        if (!Array.isArray(items) || items.length === 0) {
          this.logger.log(`Reached the end! Offset ${startOffset} returned 0 items.`);
          keepScraping = false;
          break;
        }

        // Process current page items
        items.forEach((item: any) => {
          const vacancy = item.title || item.subject || 'N/A';
          const location = Array.isArray(item.locations) && item.locations.length > 0 
            ? item.locations.join(', ') 
            : (item.location || item.city || 'თბილისი');
          const company = item.customerName || 'კომპანია';
          const id = item.announcementId;
          const publishDate = item.publishDate || '';
          const deadline = item.deadlineDate || item.deadline || item.endDate || item.expireDate || '';
          const description = item.description || '';

          if (id) {
            const link = `https://${domain}/announcement/${id}`;
            allJobs.push({
              vacancy: vacancy.trim(),
              location: location.trim(),
              company: company.trim(),
              link,
              publishDate: publishDate.trim(),
              deadline: deadline.trim(),
              page: pageCount,
              description: description.trim(),
            });
          }
        });

        this.logger.log(`Page ${pageCount} processed. Total collected so far: ${allJobs.length}`);

        const totalCount = payload?.data?.announcements?.totalCount;
        if (totalCount && allJobs.length >= totalCount) {
          this.logger.log(`Matched total database count of ${totalCount}. Scraping complete.`);
          keepScraping = false;
          break;
        }

        // If we got fewer items than the Limit, we reached the final page
        if (items.length < limit) {
          this.logger.log(`Retrieved ${items.length} items (less than limit of ${limit}). Reached the end.`);
          keepScraping = false;
          break;
        }

        if (delayBetweenRequests > 0) {
          this.logger.log(`Waiting ${delayBetweenRequests}ms before next page...`);
          await new Promise(resolve => setTimeout(resolve, delayBetweenRequests));
        }
        
        startOffset += limit;
        pageCount++;

      } catch (error) {
        this.logger.error(`Error encountered processing offset ${startOffset}`, error.stack);
        keepScraping = false;
      }
    }

    if (fetchDescriptions && allJobs.length > 0) {
      await this.enrichWithDescriptions(tenantId, allJobs, descriptionDelay, descriptionBatchSize);
    }

    this.logger.log(`Finished full scrape pipeline. Gathered ${allJobs.length} total active vacancies.`);
    return allJobs;
  }

  public async fetchDescription(tenantId: number, id: number): Promise<string> {
    const url = `https://api.p.hr.ge/public-portal/tenant/${tenantId}/api/v3/announcement/${id}`;
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json, text/plain, */*',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        }
      });

      if (!response.ok) return '';
      const payload = await response.json();
      const htmlDesc = payload?.data?.announcement?.description;

      if (htmlDesc) {
        const $ = cheerio.load(htmlDesc);
        $('br').replaceWith('\n');
        return $.text().replace(/\n{3,}/g, '\n\n').trim();
      }
    } catch (error) {
      this.logger.warn(`Failed to fetch description for ID ${id}: ${error.message}`);
    }
    return '';
  }

  private async enrichWithDescriptions(
    tenantId: number,
    jobs: JobData[],
    delayMs: number,
    batchSize: number,
  ): Promise<void> {
    this.logger.log(
      `Fetching descriptions for ${jobs.length} jobs (batch=${batchSize}, delay=${delayMs}ms)`,
    );

    for (let i = 0; i < jobs.length; i += batchSize) {
      const batch = jobs.slice(i, i + batchSize);

      for (let j = 0; j < batch.length; j++) {
        const job = batch[j];
        const parts = job.link.split('/');
        const id = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(id)) {
          job.description = await this.fetchDescription(tenantId, id);
          const index = i + j + 1;
          this.logger.debug(
            `  [${index}/${jobs.length}] Description fetched for: ${job.vacancy}`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      if (i + batchSize < jobs.length) {
        const batchPause = delayMs * 2;
        this.logger.log(
          `Batch done. Pausing ${batchPause}ms before next batch...`,
        );
        await new Promise((resolve) => setTimeout(resolve, batchPause));
      }
    }
  }
}