import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { JobData } from './jobs-ge.scraper';

export interface HrScraperOptions {
  delayBetweenRequests?: number;
  fetchDescriptions?: boolean;
  descriptionDelay?: number;
  descriptionBatchSize?: number;
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
    } = options;
    const domainMap: Record<number, string> = {
      1: 'hr.ge', 2: 'cv.ge', 4: 'doctor.ge', 5: 'chefs.ge'
    };
    const domain = domainMap[tenantId] || 'hr.ge';
    
    this.logger.log(`!!! Starting FULL Scrape for ${domain} !!!`);

    const allJobs: JobData[] = [];
    let currentPage = 1;
    let keepScraping = true;

    while (keepScraping) {
      this.logger.log(`Scraping page ${currentPage}...`);
      
      const cacheBuster = Math.floor(1000000000 + Math.random() * 9000000000);
      const url = `https://api.p.hr.ge/public-portal/tenant/${tenantId}/api/v3/announcements-main-new?Page=${currentPage}&DeviceType=2&__cb=${cacheBuster}`;

      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Accept': 'application/json, text/plain, */*',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
            'Origin': `https://${domain}`,
            'Referer': `https://${domain}/`
          }
        });

        if (!response.ok) {
          this.logger.error(`API rejected request on page ${currentPage}. Stopping batch execution.`);
          break;
        }

        const payload = await response.json();
        const items = payload?.data?.announcementList || [];

        // Rule 1: Stop immediately if the page returns nothing 
        if (!Array.isArray(items) || items.length === 0) {
          this.logger.log(`Reached the end! Page ${currentPage} returned 0 items.`);
          keepScraping = false;
          break;
        }

        // Process current page items
        items.forEach((item: any) => {
          const vacancy = item.title || item.subject || 'N/A';
          const location = item.location || item.city || 'თბილისი';
          const company = item.customerName || 'კომპანია';
          const id = item.announcementId;
          const publishDate = item.publishDate || '';
          const deadline = item.deadline || item.endDate || item.expireDate || '';
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
              page: currentPage,
              description: description.trim(),
            });
          }
        });

        this.logger.log(`Page ${currentPage} processed. Total collected so far: ${allJobs.length}`);

        // Safety Rule 2: Check if their API passes a structural limit parameter
        // For instance, if data has a totalCount, we can double check against it
        const totalCount = payload?.data?.totalCount;
        if (totalCount && allJobs.length >= totalCount) {
          this.logger.log(`Matched total database count of ${totalCount}. Scraping complete.`);
          keepScraping = false;
          break;
        }

        // Optional: Be courteous to their backend infrastructure so they don't block your IP
        if (delayBetweenRequests > 0) {
          this.logger.log(`Waiting ${delayBetweenRequests}ms before next page...`);
          await new Promise(resolve => setTimeout(resolve, delayBetweenRequests));
        }
        
        currentPage++;

      } catch (error) {
        this.logger.error(`Error encountered processing page ${currentPage}`, error.stack);
        keepScraping = false; // Break loop on critical networking crashes
      }
    }

    if (fetchDescriptions && allJobs.length > 0) {
      await this.enrichWithDescriptions(tenantId, allJobs, descriptionDelay, descriptionBatchSize);
    }

    this.logger.log(`Finished full scrape pipeline. Gathered ${allJobs.length} total active vacancies.`);
    return allJobs;
  }

  private async fetchDescription(tenantId: number, id: number): Promise<string> {
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