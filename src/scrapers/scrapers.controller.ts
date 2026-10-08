import { Controller, Post, Query, ParseIntPipe, Inject, forwardRef, UseGuards } from '@nestjs/common';
import { ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { InternalKeyGuard } from '../auth/guards/internal-key.guard';
import { HrGeScraperService } from './hr-ge-scraper.service';
import { JobsGeScraperService, ScraperResult, JobData } from './jobs-ge.scraper';
import { AworkGeScraperService, AworkScraperResult } from './awork-ge.scraper';
import { MyjobsGeScraperService, MyjobsScraperResult } from './myjobs-ge.scraper';
import { LinkedinScraperService, LinkedinScraperResult } from './linkedin.scraper';
import { JobService, LinkedinDuplicateCheckResult } from '../job/job.service';

// Every route here starts a scrape against an external portal, so all of them are
// internal only and POST (a GET could be triggered by a crawler following a link).
@ApiTags('scraper')
@ApiSecurity('internalKey')
@UseGuards(InternalKeyGuard)
@Controller('scraper')
export class ScrapersController {
  constructor(
    private readonly scraperService: HrGeScraperService,
    private readonly jobsGeScraperService: JobsGeScraperService,
    private readonly aworkGeScraperService: AworkGeScraperService,
    private readonly myjobsGeScraperService: MyjobsGeScraperService,
    private readonly linkedinScraperService: LinkedinScraperService,
    @Inject(forwardRef(() => JobService))
    private readonly jobService: JobService,
  ) {}

  @Post('sync-all')
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

  @Post('sync-jobs-ge')
  @ApiQuery({ name: 'query', required: false, type: String })
  @ApiQuery({ name: 'startPage', required: false, type: Number })
  @ApiQuery({ name: 'maxPages', required: false, type: Number })
  async syncJobsGe(
    @Query('query') query?: string,
    @Query('startPage', new ParseIntPipe({ optional: true })) startPage?: number,
    @Query('maxPages', new ParseIntPipe({ optional: true })) maxPages?: number,
  ): Promise<ScraperResult> {
    return await this.jobsGeScraperService.scrapeJobs(query || '', startPage || 1, {
      maxPages: maxPages || undefined,
      fetchDescriptions: true,
    });
  }

  @Post('sync-awork')
  @ApiQuery({ name: 'delayBetweenRequests', required: false, type: Number })
  @ApiQuery({ name: 'maxPages', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  async syncAworkGe(
    @Query('delayBetweenRequests', new ParseIntPipe({ optional: true })) delayBetweenRequests?: number,
    @Query('maxPages', new ParseIntPipe({ optional: true })) maxPages?: number,
    @Query('pageSize', new ParseIntPipe({ optional: true })) pageSize?: number,
  ): Promise<AworkScraperResult> {
    return await this.aworkGeScraperService.scrapeAllJobs({
      delayBetweenRequests: delayBetweenRequests ?? 250,
      maxPages: maxPages || undefined,
      pageSize: pageSize ?? 50,
    });
  }

  @Post('sync-myjobs')
  @ApiQuery({ name: 'delayBetweenRequests', required: false, type: Number })
  @ApiQuery({ name: 'maxPages', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  async syncMyjobsGe(
    @Query('delayBetweenRequests', new ParseIntPipe({ optional: true })) delayBetweenRequests?: number,
    @Query('maxPages', new ParseIntPipe({ optional: true })) maxPages?: number,
    @Query('pageSize', new ParseIntPipe({ optional: true })) pageSize?: number,
  ): Promise<MyjobsScraperResult> {
    return await this.myjobsGeScraperService.scrapeAllJobs({
      delayBetweenRequests: delayBetweenRequests ?? 250,
      maxPages: maxPages || undefined,
      pageSize: pageSize ?? 50,
    });
  }

  @Post('sync-linkedin')
  @ApiQuery({ name: 'query', required: false, type: String, description: 'Alias for keywords filter' })
  @ApiQuery({ name: 'keywords', required: false, type: String, description: 'Search keywords' })
  @ApiQuery({ name: 'location', required: false, type: String, description: 'Location (e.g. Tbilisi, Batumi, Georgia)' })
  @ApiQuery({ name: 'startPage', required: false, type: Number })
  @ApiQuery({ name: 'maxPages', required: false, type: Number })
  @ApiQuery({ name: 'maxPagesPerRegion', required: false, type: Number, description: 'Max pages to scrape per region when running countrywide (default: 30)' })
  @ApiQuery({ name: 'delayBetweenRequests', required: false, type: Number })
  @ApiQuery({ name: 'fetchDescriptions', required: false, type: Boolean })
  @ApiQuery({ name: 'descriptionLimit', required: false, type: Number, description: 'Limit number of descriptions to fetch (e.g. 10 or 25) to prevent rate limits' })
  async syncLinkedin(
    @Query('query') query?: string,
    @Query('keywords') keywords?: string,
    @Query('location') location?: string,
    @Query('startPage', new ParseIntPipe({ optional: true })) startPage?: number,
    @Query('maxPages', new ParseIntPipe({ optional: true })) maxPages?: number,
    @Query('maxPagesPerRegion', new ParseIntPipe({ optional: true })) maxPagesPerRegion?: number,
    @Query('delayBetweenRequests', new ParseIntPipe({ optional: true })) delayBetweenRequests?: number,
    @Query('fetchDescriptions') fetchDescriptions?: string,
    @Query('descriptionLimit', new ParseIntPipe({ optional: true })) descriptionLimit?: number,
  ): Promise<LinkedinDuplicateCheckResult> {
    const searchTerms = keywords || query || '';
    return await this.jobService.scrapeAndDeduplicateLinkedin({
      keywords: searchTerms,
      location,
      startPage,
      maxPages,
      maxPagesPerRegion: maxPagesPerRegion || 30,
      delayBetweenRequests,
      fetchDescriptions: fetchDescriptions === 'true',
      descriptionLimit: descriptionLimit || undefined,
      saveToDb: false,
    });
  }
}