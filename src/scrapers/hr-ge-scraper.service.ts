import { Injectable, Logger } from '@nestjs/common';

export interface JobListing {
  title: string;
  company: string;
  link: string;
  publishDate?: string;
}

@Injectable()
export class HrGeScraperService {
  private readonly logger = new Logger(HrGeScraperService.name);

  /**
   * Scrapes every single job listing across all pages for a given tenant
   * @param tenantId 1 = hr.ge, 2 = cv.ge, 4 = doctor.ge, 5 = chefs.ge
   */
  async scrapeAllJobs(tenantId: number = 1): Promise<JobListing[]> {
    const domainMap: Record<number, string> = {
      1: 'hr.ge', 2: 'cv.ge', 4: 'doctor.ge', 5: 'chefs.ge'
    };
    const domain = domainMap[tenantId] || 'hr.ge';
    
    this.logger.log(`!!! Starting FULL Scrape for ${domain} !!!`);

    const allJobs: JobListing[] = [];
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
          const title = item.title || item.subject || 'N/A';
          const company = item.customerName || 'N/A';
          const id = item.announcementId;

          if (id) {
            allJobs.push({
              title: title.trim(),
              company: company.trim(),
              link: `https://${domain}/en/vacancy/${id}`,
              publishDate: item.publishDate || undefined
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
        // Waits 250ms before requesting the next page
        await new Promise(resolve => setTimeout(resolve, 250));
        
        currentPage++;

      } catch (error) {
        this.logger.error(`Error encountered processing page ${currentPage}`, error.stack);
        keepScraping = false; // Break loop on critical networking crashes
      }
    }

    this.logger.log(`Finished full scrape pipeline. Gathered ${allJobs.length} total active vacancies.`);
    return allJobs;
  }
}