import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { Brackets, ILike, In, LessThan, Like, Repository } from 'typeorm';
import { JobEntity } from 'src/Entities/job.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { title } from 'process';
import { FilterJobDto } from './dto/filter-job.dto';
import { JobsGeScraperService, JobData } from '../scrapers/jobs-ge.scraper';
import { HrGeScraperService } from '../scrapers/hr-ge-scraper.service';
import * as crypto from 'crypto';


@Injectable()
export class JobService {
  private readonly logger = new Logger(JobService.name);

  constructor(
    private readonly scraperService: JobsGeScraperService,
    private readonly hrGeScraperService: HrGeScraperService,
    @InjectRepository(JobEntity) 
    private readonly jobRepo: Repository<JobEntity>
  ) {

  }
  async create(createJobDto: CreateJobDto) {
    if (!createJobDto.fingerprint) {
      const normalizedVacancy = this.normalizeText(createJobDto.vacancy);
      const normalizedCompany = this.normalizeText(createJobDto.company);
      const normalizedLocation = this.normalizeText(createJobDto.location);
      const sig = `${normalizedVacancy}|${normalizedCompany}|${normalizedLocation}`;
      createJobDto.fingerprint = crypto.createHash('md5').update(sig).digest('hex');
    }
    const job = await this.jobRepo.save(createJobDto);
    return job;
  }

  async scrapper() {
    const res = await this.scraperService.scrapeJobs('', 1, {
      fetchDescriptions: true,
      descriptionDelay: 1500,      // 1.5s between each detail page
      descriptionBatchSize: 10,
      maxPages: 17
    });
    if (res?.jobs?.length > 0) {
      await this.insertMany(res.jobs);
    }
  }


  async insertMany(createJobDto: CreateJobDto[]) {
    const values = createJobDto.map(dto => {
      if (!dto.fingerprint) {
        const normalizedVacancy = this.normalizeText(dto.vacancy);
        const normalizedCompany = this.normalizeText(dto.company);
        const normalizedLocation = this.normalizeText(dto.location);
        const sig = `${normalizedVacancy}|${normalizedCompany}|${normalizedLocation}`;
        dto.fingerprint = crypto.createHash('md5').update(sig).digest('hex');
      }
      return dto;
    });

    const chunkSize = 500;
    for (let i = 0; i < values.length; i += chunkSize) {
      const chunk = values.slice(i, i + chunkSize);
      await this.jobRepo
        .createQueryBuilder()
        .insert()
        .into(JobEntity)
        .values(chunk)
        .orIgnore() // skips duplicates based on unique link/fingerprint constraints
        .execute();
    }
  }

  async findDuplicates() {
    // Group by link and count occurrences
    const duplicates = await this.jobRepo
      .createQueryBuilder('job')
      .select('job.link', 'link')
      .addSelect('COUNT(job.id)', 'count')
      .groupBy('job.link')
      .having('COUNT(job.id) > 1')
      .getRawMany();

    return duplicates; // returns array of { link: '...', count: 2 }
  }
  async findAll(filterDto: FilterJobDto) {
    const { query, page = 1, limit = 10 } = filterDto;
    const skip = (page - 1) * limit;

    const qb = this.jobRepo.createQueryBuilder('job');

    let hasFilter = false;

    if (query && query.trim().length > 0) {
      hasFilter = true;

      const terms = query.trim().toLowerCase().split(/\s+/);

      qb.andWhere(
        new Brackets((qb2) => {
          terms.forEach((term, i) => {
            const param = `query${i}`;
            if (i === 0) {
              qb2.where(`LOWER(job.vacancy) LIKE :${param}`, { [param]: `%${term}%` });
            } else {
              qb2.orWhere(`LOWER(job.vacancy) LIKE :${param}`, { [param]: `%${term}%` });
            }
          });
        })
      );
    }

    const [jobs, filteredRecords] = await qb.take(limit).skip(skip).getManyAndCount();
    const totalRecords = await this.jobRepo.count();

    return {
      jobs,
      counts: {
        totalRecords,
        filteredRecords: hasFilter ? filteredRecords : totalRecords,
      },
      page,
      limit,
    };
  }

  async findAllByQuery(query: string | string[]) {
    const queries = (Array.isArray(query) ? query : [query])
      .filter((q) => typeof q === 'string' && q.trim().length > 0);

    if (queries.length === 0) return [];

    const georgianTokens = queries.filter(q => /[\u10D0-\u10FF]/.test(q));
    const englishTokens = queries.filter(q => !/[\u10D0-\u10FF]/.test(q));

    const qb = this.jobRepo.createQueryBuilder('job');

    // Title match = 3 points, description match = 1 point
    const buildClauses = (tokens: string[], prefix: string, titleWeight = 3, descWeight = 1) =>
      tokens.map((q, i) => {
        const p = `${prefix}${i}`;
        qb.setParameter(p, `%${q.toLowerCase()}%`);
        return `(
        CASE WHEN LOWER(job.vacancy) LIKE :${p} THEN ${titleWeight} ELSE 0 END +
        CASE WHEN LOWER(job.description) LIKE :${p} THEN ${descWeight} ELSE 0 END
      )`;
      });

    const enClauses = buildClauses(englishTokens, 'en');
    const kaClauses = buildClauses(georgianTokens, 'ka');

    const allClauses = [...enClauses, ...kaClauses];
    const totalScore = allClauses.length > 0
      ? `(${allClauses.join(' + ')})`
      : '0';

    // Minimum score of 3 = at least one title match, filters out weak description-only hits
    qb.where(`${totalScore} >= 3`)
      .orderBy(totalScore, 'DESC')
      .limit(60); // send fewer, better jobs to Gemini

    return qb.getMany();
  }
  async findOne(id: number) {
    const job = await this.jobRepo.findOne({ where: { id } });
    if (!job) {
      throw new NotFoundException(`Job with ID ${id} not found`);
    }
    return job;
  }

  async update(id: number, updateJobDto: UpdateJobDto) {
    const job = await this.jobRepo.findOne({ where: { id } })
    if (!job) {
      throw new NotFoundException(`Job with ID ${id} not found`);
    }
    const updated = Object.assign(job, updateJobDto)
    await this.jobRepo.save(updated)
    return updated;
  }

  async remove(id: number) {
    const job = await this.jobRepo.findOne({ where: { id } })
    if (!job) {
      throw new NotFoundException(`Job with ID ${id} not found`);
    }
    return await this.jobRepo.remove(job);
  }

  async removeOutdated(): Promise<void> {
    await this.jobRepo
      .createQueryBuilder()
      .delete()
      .from(JobEntity)
      .where('deadline IS NOT NULL')
      .andWhere(`
      CASE 
        WHEN deadline ~ '^\\d{2}/\\d{2}/\\d{4}$' 
        THEN TO_DATE(deadline, 'DD/MM/YYYY') < CURRENT_DATE 
        ELSE false 
      END
    `)
      .execute();
  }
  hardRemove() {
    return this.jobRepo.clear();
  }

  async manualScrapper() {
    const res = await this.scraperService.scrapeJobs('', 1, {
      fetchDescriptions: true,
      descriptionDelay: 1500,      // 1.5s between each detail page
      descriptionBatchSize: 10,
      maxPages: 1
    });
    if (res?.jobs?.length > 0) {
      await this.insertMany(res.jobs);
    }
  }

  private normalizeText(text: string): string {
    return (text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\u10D0-\u10FF]/g, '')
      .trim();
  }

  async scrapeAndDeduplicatePreview(query = '') {
    this.logger.log(`Starting sequential preview scrape and deduplicate for query: "${query}"`);

    // 1. First scrape hr.ge fully
    this.logger.log('Step 1: Scraping HR.ge fully...');
    const hrGeJobs = await this.hrGeScraperService.scrapeAllJobs();

    // 2. Then scrape jobs.ge up to 17 pages
    this.logger.log('Step 2: Scraping jobs.ge up to 17 pages...');
    const jobsGeResult = await this.scraperService.scrapeJobs(query, 1, {
      fetchDescriptions: false,
    });

    const jobsGeJobs = jobsGeResult?.jobs || [];
    const combined = [...jobsGeJobs, ...hrGeJobs];

    const uniqueMap = new Map<string, JobData>();

    for (const job of combined) {
      const normalizedVacancy = this.normalizeText(job.vacancy);
      const normalizedCompany = this.normalizeText(job.company);
      const normalizedLocation = this.normalizeText(job.location);

      const sig = `${normalizedVacancy}|${normalizedCompany}|${normalizedLocation}`;

      const existing = uniqueMap.get(sig);
      if (!existing) {
        uniqueMap.set(sig, job);
      } else {
        const currentDescLen = (job.description || '').length;
        const existingDescLen = (existing.description || '').length;
        if (currentDescLen > existingDescLen) {
          uniqueMap.set(sig, job);
        }
      }
    }

    const uniqueJobs = Array.from(uniqueMap.values());

    return {
      jobsGeCount: jobsGeJobs.length,
      hrGeCount: hrGeJobs.length,
      totalCombined: combined.length,
      uniqueCount: uniqueJobs.length,
      jobs: uniqueJobs,
    };
  }

  async scrapeAndSaveAll() {
    this.logger.log('Starting fast sequential scraping without descriptions and database save...');

    // 1. Scrape HR.ge fully (no descriptions)
    this.logger.log('Step 1: Scraping HR.ge fully...');
    const hrGeJobs = await this.hrGeScraperService.scrapeAllJobs(1, {
      fetchDescriptions: false,
      delayBetweenRequests: 250,
    });

    // 2. Scrape jobs.ge up to 17 pages (no descriptions)
    this.logger.log('Step 2: Scraping jobs.ge up to 17 pages...');
    const jobsGeResult = await this.scraperService.scrapeJobs('', 1, {
      fetchDescriptions: false,
    });

    const jobsGeJobs = jobsGeResult?.jobs || [];
    const combined = [...jobsGeJobs, ...hrGeJobs];

    const uniqueMap = new Map<string, any>();

    for (const job of combined) {
      const normalizedVacancy = this.normalizeText(job.vacancy);
      const normalizedCompany = this.normalizeText(job.company);
      const normalizedLocation = this.normalizeText(job.location);

      const sig = `${normalizedVacancy}|${normalizedCompany}|${normalizedLocation}`;
      const fingerprint = crypto.createHash('md5').update(sig).digest('hex');

      const jobWithFingerprint = {
        ...job,
        fingerprint,
      };

      const existing = uniqueMap.get(fingerprint);
      if (!existing) {
        uniqueMap.set(fingerprint, jobWithFingerprint);
      } else {
        const currentDescLen = (job.description || '').length;
        const existingDescLen = (existing.description || '').length;
        if (currentDescLen > existingDescLen) {
          uniqueMap.set(fingerprint, jobWithFingerprint);
        }
      }
    }

    const uniqueJobs = Array.from(uniqueMap.values());

    this.logger.log(`Inserting ${uniqueJobs.length} unique jobs into the database...`);
    await this.insertMany(uniqueJobs);
    this.logger.log('Insertion completed successfully. Initial jobs are saved!');

    // Start background enrichment without awaiting
    this.enrichMissingDescriptionsInBackground().catch(err => {
      this.logger.error('Background description enrichment failed', err);
    });

    return {
      jobsGeCount: jobsGeJobs.length,
      hrGeCount: hrGeJobs.length,
      totalCombined: combined.length,
      uniqueCount: uniqueJobs.length,
      message: 'Successfully scraped, deduplicated, and inserted unique jobs. Description enrichment is running in the background.',
    };
  }

  async enrichMissingDescriptionsInBackground() {
    this.logger.log('Starting background description enrichment...');
    
    // Find all jobs with empty/null descriptions
    const jobsToEnrich = await this.jobRepo
      .createQueryBuilder('job')
      .where('job.description IS NULL OR job.description = :empty', { empty: '' })
      .getMany();
    
    this.logger.log(`Found ${jobsToEnrich.length} jobs requiring description enrichment.`);

    const delayMs = 1500;
    const batchSize = 10;

    for (let i = 0; i < jobsToEnrich.length; i += batchSize) {
      const batch = jobsToEnrich.slice(i, i + batchSize);

      for (let j = 0; j < batch.length; j++) {
        const job = batch[j];
        try {
          let desc = '';
          if (job.link.includes('hr.ge') || job.link.includes('cv.ge') || job.link.includes('doctor.ge') || job.link.includes('chefs.ge')) {
            const parts = job.link.split('/');
            const id = parseInt(parts[parts.length - 1], 10);
            if (!isNaN(id)) {
              let tenantId = 1;
              if (job.link.includes('cv.ge')) tenantId = 2;
              else if (job.link.includes('doctor.ge')) tenantId = 4;
              else if (job.link.includes('chefs.ge')) tenantId = 5;

              desc = await this.hrGeScraperService.fetchDescription(tenantId, id);
            }
          } else if (job.link.includes('jobs.ge')) {
            desc = await this.scraperService.fetchDescription(job.link);
          }

          if (desc && desc.trim().length > 0) {
            job.description = desc.trim();
            await this.jobRepo.save(job);
            const index = i + j + 1;
            this.logger.log(`[Background Enrichment] [${index}/${jobsToEnrich.length}] Saved description for: ${job.vacancy}`);
          }
        } catch (error) {
          this.logger.warn(`Failed to enrich description for job ${job.id}: ${error.message}`);
        }
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      if (i + batchSize < jobsToEnrich.length) {
        const batchPause = delayMs * 2;
        await new Promise((resolve) => setTimeout(resolve, batchPause));
      }
    }

    this.logger.log('Background description enrichment completed.');
  }
}
