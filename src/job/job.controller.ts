import { Controller, Get, Post, Body, Patch, Param, Delete, Query, ParseIntPipe, BadRequestException, ForbiddenException, NotFoundException, UseGuards, Req, Logger } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiBody, ApiConflictResponse, ApiCreatedResponse, ApiOperation, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { InternalKeyGuard } from 'src/auth/guards/internal-key.guard';
import { ClientIpThrottlerGuard } from 'src/auth/guards/client-ip-throttler.guard';
import { JobService } from './job.service';
import { ScrapeQueueService } from './scrape-queue.service';
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { FilterJobDto } from './dto/filter-job.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from 'src/auth/guards/optional-jwt-auth.guard';

@ApiTags('job')
@Controller('job')
export class JobController {
  private readonly logger = new Logger(JobController.name);

  constructor(
    private readonly jobService: JobService,
    private readonly scrapeQueueService: ScrapeQueueService,
  ) { }

  @ApiSecurity('internalKey')
  @UseGuards(InternalKeyGuard)
  @ApiOperation({ summary: 'Queue a full scrape of all sources (jobs.ge, hr.ge, awork.ge, myjobs.ge, linkedin) via BullMQ' })
  @Post('scrape-all')
  async scrapeAllPost() {
    return await this.scrapeQueueService.enqueueDailyScrape();
  }

  @ApiSecurity('internalKey')
  @UseGuards(InternalKeyGuard)
  @ApiOperation({ summary: 'Get the state of a queued scrape flow' })
  @Get('scrape-status/:flowId')
  async scrapeStatus(@Param('flowId') flowId: string) {
    const status = await this.scrapeQueueService.getFlowStatus(flowId);
    if (!status) throw new NotFoundException(`Scrape flow ${flowId} not found`);
    return status;
  }

  @ApiSecurity('internalKey')
  @UseGuards(InternalKeyGuard)
  @ApiOperation({ summary: 'Queue description enrichment for all jobs missing a description' })
  @Post('enrich-descriptions')
  async enrichDescriptions() {
    return await this.scrapeQueueService.enqueueEnrichment();
  }

  @ApiSecurity('internalKey')
  @UseGuards(InternalKeyGuard)
  @Post('scrapper')
  async scrapper(): Promise<boolean> {
    await this.jobService.scrapper();
    return true;
  }



  // Internal only: any logged-in user could otherwise publish jobs (with HTML) on the site.
  @ApiSecurity('internalKey')
  @UseGuards(InternalKeyGuard)
  @ApiOperation({ summary: 'Create a single job vacancy' })
  @ApiBody({
    type: CreateJobDto,
    examples: {
      minimal: {
        summary: 'Required fields only',
        value: {
          vacancy: 'Senior Backend Developer (Node.js)',
          location: 'თბილისი',
          company: 'Job Up',
          link: 'https://jobs.ge/ge/?view=jobs&id=123456',
          publishDate: '2026-09-23',
          deadline: '2026-10-23',
        },
      },
      full: {
        summary: 'All fields',
        value: {
          vacancy: 'Senior Backend Developer (Node.js)',
          location: 'თბილისი',
          company: 'Job Up',
          link: 'https://jobs.ge/ge/?view=jobs&id=123457',
          publishDate: '2026-09-23',
          deadline: '2026-10-23',
          page: 1,
          description: 'We are looking for a backend developer with 4+ years of experience in Node.js, NestJS and PostgreSQL.',
        },
      },
    },
  })
  @ApiCreatedResponse({ description: 'Job created' })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiConflictResponse({ description: 'A job with the same link or fingerprint already exists' })
  @Post('create')
  async create(@Body() createJobDto: CreateJobDto) {
    return await this.jobService.create(createJobDto);
  }
  
  @ApiBearerAuth('bearerAuth')
  @UseGuards(OptionalJwtAuthGuard, ClientIpThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60000 } }) // 60 requests per minute per visitor
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Max 50' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'query', required: false, type: String })
  @ApiQuery({ name: 'source', required: false, type: String, description: 'Source filter (e.g. jobs.ge, hr.ge, awork.ge, myjobs.ge, linkedin)' })
  @ApiQuery({ name: 'company', required: false, type: String })
  @ApiQuery({ name: 'location', required: false, type: String })
  @ApiQuery({ name: 'publishDate', required: false, type: String })
  @Get('all')
  async findAll(@Query() filterDto: FilterJobDto, @Req() req: any) {
    const page = Math.max(1, Number(filterDto.page) || 1);

    if (page > 5 && !req?.user) {
      throw new ForbiddenException('Authentication is required to view pages beyond page 5');
    }

    return await this.jobService.findAll(filterDto);
  }

  @ApiSecurity('internalKey')
  @UseGuards(InternalKeyGuard)
  @ApiOperation({ summary: 'Lightweight list of all jobs, newest first, for the sitemap and indexing notifier' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Only the newest N jobs' })
  @Get('sitemap')
  async sitemap(@Query('limit') limit?: string) {
    const n = Number(limit);
    return await this.jobService.findForSitemap(Number.isInteger(n) && n > 0 ? n : undefined);
  }

  @ApiQuery({ name: 'search', required: false, type: String })
  @Get('cities')
  async getJobsCountByLocation(@Query('search') search?: string) {
    return await this.jobService.getJobsCountByLocation(search);
  }

  @ApiBearerAuth('bearerAuth')
  @UseGuards(JwtAuthGuard)
  @Get('search')
  @ApiQuery({ name: 'query', required: false, type: [String] })
  async searchJobs(@Query('query') query: string | string[]) {
    return this.jobService.findAllByQuery(query);
  }

  @ApiBearerAuth('bearerAuth')
  @UseGuards(JwtAuthGuard)
  @Get('check-duplicates')
  async checkDuplicates() {
    const duplicates = await this.jobService.findDuplicates();
    return {
      totalDuplicates: duplicates.length,
      duplicates,
    };
  }
  @ApiSecurity('internalKey')
  @UseGuards(InternalKeyGuard)
  @Get('outdated')
  async getOutdated() {
    const outdated = await this.jobService.findOutdated();
    return {
      totalOutdated: outdated.length,
      outdated,
    };
  }
  @ApiSecurity('internalKey')
  @UseGuards(InternalKeyGuard)
  @Delete('outdated')
  async removeOutdated() {
    return await this.jobService.removeOutdated();
  }
  
  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return await this.jobService.findOne(id);
  }
  // Job management is internal only: these used to accept any logged-in user,
  // and DELETE /job wipes the whole table.
  @ApiSecurity('internalKey')
  @UseGuards(InternalKeyGuard)
  @Patch(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() updateJobDto: UpdateJobDto) {
    return await this.jobService.update(id, updateJobDto);
  }
  @ApiSecurity('internalKey')
  @UseGuards(InternalKeyGuard)
  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    return await this.jobService.remove(id);
  }
  @ApiSecurity('internalKey')
  @UseGuards(InternalKeyGuard)
  @Delete()
  async hardDelete() {
    return this.jobService.hardRemove();
  }
}
