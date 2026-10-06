import { Controller, Get, Post, Body, Patch, Param, Delete, Query, ParseIntPipe, BadRequestException, ForbiddenException, NotFoundException, UseGuards, Req, Logger } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiBody, ApiConflictResponse, ApiCreatedResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
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

  @ApiOperation({ summary: 'Queue a full scrape of all sources (jobs.ge, hr.ge, awork.ge, myjobs.ge, linkedin) via BullMQ' })
  @Post('scrape-all')
  async scrapeAllPost() {
    return await this.scrapeQueueService.enqueueDailyScrape();
  }

  @ApiOperation({ summary: 'Queue a full scrape of all sources (jobs.ge, hr.ge, awork.ge, myjobs.ge, linkedin) via BullMQ' })
  @Get('scrape-all')
  async scrapeAllGet() {
    return await this.scrapeQueueService.enqueueDailyScrape();
  }

  @ApiOperation({ summary: 'Get the state of a queued scrape flow' })
  @Get('scrape-status/:flowId')
  async scrapeStatus(@Param('flowId') flowId: string) {
    const status = await this.scrapeQueueService.getFlowStatus(flowId);
    if (!status) throw new NotFoundException(`Scrape flow ${flowId} not found`);
    return status;
  }

  @ApiOperation({ summary: 'Queue description enrichment for all jobs missing a description' })
  @Post('enrich-descriptions')
  async enrichDescriptions() {
    return await this.scrapeQueueService.enqueueEnrichment();
  }

  @Post('scrapper')
  async scrapper(): Promise<boolean> {
    await this.jobService.scrapper();
    return true;
  }



  @ApiBearerAuth('bearerAuth')
  @UseGuards(JwtAuthGuard)
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
  @UseGuards(OptionalJwtAuthGuard)
  @ApiQuery({ name: 'limit', required: false, type: Number })
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
  @ApiBearerAuth('bearerAuth')
  @UseGuards(JwtAuthGuard)
  @Get('outdated')
  async getOutdated() {
    const outdated = await this.jobService.findOutdated();
    return {
      totalOutdated: outdated.length,
      outdated,
    };
  }
  @ApiBearerAuth('bearerAuth')
  @UseGuards(JwtAuthGuard)
  @Delete('outdated')
  async removeOutdated() {
    return await this.jobService.removeOutdated();
  }
  
  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return await this.jobService.findOne(id);
  }
  @ApiBearerAuth('bearerAuth')
  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() updateJobDto: UpdateJobDto) {
    return await this.jobService.update(id, updateJobDto);
  }
  @ApiBearerAuth('bearerAuth')
  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    return await this.jobService.remove(id);
  }
  @ApiBearerAuth('bearerAuth')
  @UseGuards(JwtAuthGuard)
  @Delete()
  async hardDelete() {
    return this.jobService.hardRemove();
  }
}
