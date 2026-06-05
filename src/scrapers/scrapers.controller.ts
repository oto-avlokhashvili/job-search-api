import { Controller, Get, Query, ParseIntPipe } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { HrGeScraperService } from './hr-ge-scraper.service';
import { JobsGeScraperService, ScraperResult, JobData } from './jobs-ge.scraper';

@ApiTags('scraper')
@Controller('scraper')
export class ScrapersController {
  constructor(
    private readonly scraperService: HrGeScraperService,
    private readonly jobsGeScraperService: JobsGeScraperService,
  ) {}

  @Get('sync-all')
  @ApiQuery({ name: 'tenantId', required: false, type: Number })
  @ApiQuery({ name: 'delayBetweenRequests', required: false, type: Number })
  @ApiQuery({ name: 'fetchDescriptions', required: false, type: Boolean })
  @ApiQuery({ name: 'descriptionDelay', required: false, type: Number })
  @ApiQuery({ name: 'descriptionBatchSize', required: false, type: Number })
  async syncAllJobs(
    @Query('tenantId', new ParseIntPipe({ optional: true })) tenantId?: number,
    @Query('delayBetweenRequests', new ParseIntPipe({ optional: true })) delayBetweenRequests?: number,
    @Query('fetchDescriptions') fetchDescriptions?: string,
    @Query('descriptionDelay', new ParseIntPipe({ optional: true })) descriptionDelay?: number,
    @Query('descriptionBatchSize', new ParseIntPipe({ optional: true })) descriptionBatchSize?: number,
  ): Promise<JobData[]> {
    // This will run through every page sequentially until it hits the end!
    return await this.scraperService.scrapeAllJobs(tenantId || 1, {
      delayBetweenRequests: delayBetweenRequests ?? 250,
      fetchDescriptions: fetchDescriptions === 'true',
      descriptionDelay: descriptionDelay ?? 1500,
      descriptionBatchSize: descriptionBatchSize ?? 10,
    });
  }

  @Get('sync-jobs-ge')
  @ApiQuery({ name: 'query', required: false, type: String })
  @ApiQuery({ name: 'startPage', required: false, type: Number })
  @ApiQuery({ name: 'maxPages', required: false, type: Number })
  async syncJobsGe(
    @Query('query') query?: string,
    @Query('startPage', new ParseIntPipe({ optional: true })) startPage?: number,
    @Query('maxPages', new ParseIntPipe({ optional: true })) maxPages?: number,
  ): Promise<ScraperResult> {
    return await this.jobsGeScraperService.scrapeJobs(query || '', startPage || 1, {
      maxPages: maxPages || 17,
      fetchDescriptions: true,
    });
  }
}