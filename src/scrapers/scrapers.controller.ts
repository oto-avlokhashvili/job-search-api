import { Controller, Get, Query, ParseIntPipe } from '@nestjs/common';
import { HrGeScraperService, JobListing } from './hr-ge-scraper.service';

@Controller('scraper')
export class ScrapersController {
  constructor(private readonly scraperService: HrGeScraperService) {}

@Get('sync-all')
async syncAllJobs(
  @Query('tenantId', new ParseIntPipe({ optional: true })) tenantId?: number
): Promise<JobListing[]> {
  // This will run through every page sequentially until it hits the end!
  return await this.scraperService.scrapeAllJobs(tenantId || 1);
}
}