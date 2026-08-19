import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { Brackets, ILike, In, LessThan, Like, Repository } from 'typeorm';
import { JobEntity } from 'src/Entities/job.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { FilterJobDto } from './dto/filter-job.dto';
import { JobsGeScraperService, JobData } from '../scrapers/jobs-ge.scraper';
import { HrGeScraperService } from '../scrapers/hr-ge-scraper.service';
import { AworkGeScraperService } from '../scrapers/awork-ge.scraper';
import { MyjobsGeScraperService } from '../scrapers/myjobs-ge.scraper';
import * as crypto from 'crypto';

export const CITY_MAPPING: { [city: string]: string[] } = {
  'თბილისი': [
    'თბილისი', 'tbilisi', 'საბურთალო', 'დიღომი', 'ვარკეთილი', 'გლდანი', 'ისანი', 'სამგორი',
    'ვაკე', 'ვერა', 'მთაწმინდა', 'ლილო', 'ორხევი', 'ავჭალა', 'სანზონა', 'თემქა', 'დიდუბე',
    'ნუცუბიძე', 'წერეთელი', 'ერისთავი', 'პეკინი', 'დადიანი', 'მარჯანიშვილი', 'მელიქიშვილი',
    'ვაჟა-ფშაველა', 'ასათიანი', 'დელისი', 'ჯიქია', 'ბაგები', 'წავკისი', 'კიკეთი', 'ოქროყანა',
    'ორთაჭალა', 'ნავთლუღი', 'ზაჰესი', 'წყნეთი', 'სითი მოლი', 'გალერია', 'ისთ ფოინთი',
    'თბილისი მოლი', 'აეროპორტი', 'ეროვნული სტადიონი', 'გლდანულა', 'ვარკეთილის', 'ცინცაძე',
    'ქარვასლა', 'outlet village', 'აუთლეთ ვილიჯი', 'მეტრომშენი', 'სავაჭრო ცენტრი',
    'უნივერსიტეტის ქუჩა', 'ვაზისუბანი', 'აღმაშენებლის ექსპატ სერვისცენტრი', 'წერეთლის ს/ც 3',
    'ცხვარიჭამია', 'დიღმის მასივი', 'დიღმის ს/ც 2', 'დიდი დიღმის ს/ც 1', 'ორთაჭალის ს/ც 1',
    'ფულ & ბეარ'
  ],
  'ბათუმი': ['ბათუმი', 'batumi'],
  'ქუთაისი': ['ქუთაისი', 'kutaisi'],
  'რუსთავი': ['რუსთავი', 'rustavi'],
  'გორი': ['გორი', 'gori'],
  'ზუგდიდი': ['ზუგდიდი', 'zugdidi'],
  'ფოთი': ['ფოთი', 'poti'],
  'თელავი': ['თელავი', 'telavi'],
  'ახალციხე': ['ახალციხე', 'akhaltsikhe'],
  'ოზურგეთი': ['ოზურგეთი', 'ozurgeti'],
  'მცხეთა': ['მცხეთა', 'mtskheta'],
  'სიღნაღი': ['სიღნაღი', 'sighnaghi']
};

@Injectable()
export class JobService {
  private readonly logger = new Logger(JobService.name);
  private citiesCache: { location: string; count: number }[] | null = null;

  constructor(
    private readonly scraperService: JobsGeScraperService,
    private readonly hrGeScraperService: HrGeScraperService,
    private readonly aworkGeScraperService: AworkGeScraperService,
    private readonly myjobsGeScraperService: MyjobsGeScraperService,
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
    this.citiesCache = null; // Invalidate cache
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
    this.citiesCache = null; // Invalidate cache
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
    const { query, page = 1, limit = 10, source, company, location, publishDate } = filterDto;
    const skip = (page - 1) * limit;

    const qb = this.jobRepo.createQueryBuilder('job');

    let hasFilter = false;

    if (query && query.trim().length > 0) {
      hasFilter = true;

      const trimmedQuery = query.trim().toLowerCase();
      const terms = trimmedQuery.split(/\s+/).filter((t) => t.length > 0);

      qb.andWhere(
        new Brackets((qb2) => {
          terms.forEach((term, i) => {
            const param = `searchTerm${i}`;
            qb.setParameter(param, `%${term}%`);
            if (i === 0) {
              qb2.where(
                `(LOWER(job.vacancy) LIKE :${param} OR LOWER(job.description) LIKE :${param})`
              );
            } else {
              qb2.orWhere(
                `(LOWER(job.vacancy) LIKE :${param} OR LOWER(job.description) LIKE :${param})`
              );
            }
          });
        })
      );

      const scoreClauses: string[] = [];

      // Whole phrase matches (give huge boost for exact title phrase, moderate boost for exact description phrase)
      if (terms.length > 1) {
        qb.setParameter('wholePhrase', `%${trimmedQuery}%`);
        scoreClauses.push(
          `CASE WHEN LOWER(job.vacancy) LIKE :wholePhrase THEN 50 ELSE 0 END`,
          `CASE WHEN LOWER(job.description) LIKE :wholePhrase THEN 10 ELSE 0 END`
        );
      }

      // Individual term matches: Title match = 10 pts, Description match = 1 pt
      terms.forEach((term, i) => {
        const param = `searchTerm${i}`;
        scoreClauses.push(
          `(CASE WHEN LOWER(job.vacancy) LIKE :${param} THEN 10 ELSE 0 END +
            CASE WHEN LOWER(job.description) LIKE :${param} THEN 1 ELSE 0 END)`
        );
      });

      const orderScoreSql = `(${scoreClauses.join(' + ')})`;
      qb.orderBy(orderScoreSql, 'DESC');
      qb.addOrderBy('job.id', 'DESC');
    }

    if (source && source.trim().length > 0) {
      hasFilter = true;
      const lowerSource = source.trim().toLowerCase();
      if (lowerSource === 'hr.ge' || lowerSource === 'hrge') {
        qb.andWhere(
          new Brackets((qbSource) => {
            qbSource.where('job.link LIKE :hrGe', { hrGe: '%hr.ge%' })
                    .orWhere('job.link LIKE :cvGe', { cvGe: '%cv.ge%' })
                    .orWhere('job.link LIKE :doctorGe', { doctorGe: '%doctor.ge%' })
                    .orWhere('job.link LIKE :chefsGe', { chefsGe: '%chefs.ge%' });
          })
        );
      } else if (lowerSource === 'awork' || lowerSource === 'awork.ge' || lowerSource === 'aworkge') {
        qb.andWhere('job.link LIKE :sourcePattern', { sourcePattern: '%awork%' });
      } else if (lowerSource === 'jobs.ge' || lowerSource === 'jobsge') {
        qb.andWhere('job.link LIKE :sourcePattern', { sourcePattern: '%jobs.ge%' });
      } else if (lowerSource === 'myjobs' || lowerSource === 'myjobs.ge' || lowerSource === 'myjobsge') {
        qb.andWhere('job.link LIKE :sourcePattern', { sourcePattern: '%myjobs%' });
      } else {
        qb.andWhere('job.link LIKE :sourcePattern', { sourcePattern: `%${lowerSource}%` });
      }
    }

    if (company && company.trim().length > 0) {
      hasFilter = true;
      qb.andWhere('LOWER(job.company) LIKE :company', { company: `%${company.trim().toLowerCase()}%` });
    }

    if (location && location.trim().length > 0) {
      hasFilter = true;
      const trimmedLoc = location.trim();
      const searchKey = trimmedLoc.toLowerCase();
      const mappingKey = Object.keys(CITY_MAPPING).find(
        key => key.toLowerCase() === searchKey || CITY_MAPPING[key].some(kw => kw.toLowerCase() === searchKey)
      );
      const mappedKeywords = mappingKey ? CITY_MAPPING[mappingKey] : null;

      if (mappedKeywords && mappedKeywords.length > 0) {
        qb.andWhere(
          new Brackets((qbLoc) => {
            mappedKeywords.forEach((kw, idx) => {
              const paramName = `locKw${idx}`;
              if (idx === 0) {
                qbLoc.where(`LOWER(job.location) LIKE :${paramName}`, { [paramName]: `%${kw.toLowerCase()}%` });
              } else {
                qbLoc.orWhere(`LOWER(job.location) LIKE :${paramName}`, { [paramName]: `%${kw.toLowerCase()}%` });
              }
            });
          })
        );
      } else {
        qb.andWhere('LOWER(job.location) LIKE :location', { location: `%${searchKey}%` });
      }
    }

    if (publishDate && publishDate.trim().length > 0) {
      hasFilter = true;
      qb.andWhere(
        `CASE 
          WHEN TRIM(job.publishDate) ~ '^\\d{2}/\\d{2}/\\d{4}$' 
          THEN TO_DATE(TRIM(job.publishDate), 'DD/MM/YYYY') 
          WHEN TRIM(job.publishDate) ~ '^\\d{4}-\\d{2}-\\d{2}'
          THEN TO_DATE(SUBSTRING(TRIM(job.publishDate) FROM 1 FOR 10), 'YYYY-MM-DD')
          ELSE NULL 
        END >= :publishDate::date`,
        { publishDate: publishDate.trim() }
      );
    }

    const [jobs, filteredRecords] = await qb.take(limit).skip(skip).getManyAndCount();
    const totalRecords = await this.jobRepo.count();

    const totalJobsGe = await this.jobRepo.count({
      where: {
        link: Like('%jobs.ge%'),
      },
    });

    const totalHrGe = await this.jobRepo.count({
      where: [
        { link: Like('%hr.ge%') },
        { link: Like('%cv.ge%') },
        { link: Like('%doctor.ge%') },
        { link: Like('%chefs.ge%') },
      ],
    });

    const totalAworkGe = await this.jobRepo.count({
      where: [
        { link: Like('%awork.ge%') },
        { link: Like('%awork%') },
      ],
    });

    const totalMyjobsGe = await this.jobRepo.count({
      where: [
        { link: Like('%myjobs.ge%') },
        { link: Like('%myjobs%') },
      ],
    });

    return {
      jobs,
      counts: {
        totalRecords,
        filteredRecords: hasFilter ? filteredRecords : totalRecords,
        jobsGe: totalJobsGe,
        hrGe: totalHrGe,
        aworkGe: totalAworkGe,
        myjobsGe: totalMyjobsGe,
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

    // Title match = 10 points, description match = 1 point
    const buildClauses = (tokens: string[], prefix: string, titleWeight = 10, descWeight = 1) =>
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

    qb.where(`${totalScore} >= 1`)
      .orderBy(totalScore, 'DESC')
      .limit(60); // send top matches

    return qb.getMany();
  }

  async getJobsCountByLocation(search?: string): Promise<{ location: string; count: number }[]> {
    if (!this.citiesCache) {
      const caseClauses: string[] = [];

      for (const [city, keywords] of Object.entries(CITY_MAPPING)) {
        const conditions = keywords
          .map(kw => `LOWER(job.location) LIKE '%${kw.replace(/'/g, "''").toLowerCase()}%'`)
          .join(' OR ');
        caseClauses.push(`WHEN ${conditions} THEN '${city}'`);
      }

      const caseExpression = `(CASE 
        ${caseClauses.join('\n        ')}
        ELSE NULL
      END)`;

      const rawStats = await this.jobRepo
        .createQueryBuilder('job')
        .select(caseExpression, 'location')
        .addSelect('COUNT(job.id)', 'count')
        .where(`${caseExpression} IS NOT NULL`)
        .groupBy(caseExpression)
        .orderBy('count', 'DESC')
        .getRawMany();

      this.citiesCache = rawStats.map(stat => ({
        location: stat.location,
        count: parseInt(stat.count, 10),
      }));
    }

    let result = [...this.citiesCache];

    if (search && search.trim().length > 0) {
      const query = search.trim().toLowerCase();
      result = result.filter(item => {
        const keywords = CITY_MAPPING[item.location] || [];
        return (
          item.location.toLowerCase().includes(query) ||
          keywords.some(kw => kw.toLowerCase().includes(query))
        );
      });
    }

    return result;
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
    this.citiesCache = null; // Invalidate cache
    return updated;
  }

  async remove(id: number) {
    const job = await this.jobRepo.findOne({ where: { id } })
    if (!job) {
      throw new NotFoundException(`Job with ID ${id} not found`);
    }
    const result = await this.jobRepo.remove(job);
    this.citiesCache = null; // Invalidate cache
    return result;
  }

  async findOutdated(): Promise<JobEntity[]> {
    return await this.jobRepo
      .createQueryBuilder('job')
      .where(`
        (deadline IS NOT NULL AND TRIM(deadline) != '' AND 
          CASE 
            WHEN TRIM(deadline) ~ '^\\d{2}/\\d{2}/\\d{4}$' 
            THEN TO_DATE(TRIM(deadline), 'DD/MM/YYYY') < CURRENT_DATE 
            WHEN TRIM(deadline) ~ '^\\d{4}-\\d{2}-\\d{2}'
            THEN TO_DATE(SUBSTRING(TRIM(deadline) FROM 1 FOR 10), 'YYYY-MM-DD') < CURRENT_DATE
            ELSE false 
          END
        )
        OR 
        (
          (deadline IS NULL OR TRIM(deadline) = '') 
          AND (
            "publishDate" IS NOT NULL AND TRIM("publishDate") != '' AND
            CASE 
              WHEN TRIM("publishDate") ~ '^\\d{2}/\\d{2}/\\d{4}$' 
              THEN TO_DATE(TRIM("publishDate"), 'DD/MM/YYYY') < CURRENT_DATE - INTERVAL '1 month'
              WHEN TRIM("publishDate") ~ '^\\d{4}-\\d{2}-\\d{2}'
              THEN TO_DATE(SUBSTRING(TRIM("publishDate") FROM 1 FOR 10), 'YYYY-MM-DD') < CURRENT_DATE - INTERVAL '1 month'
              ELSE false 
            END
          )
        )
      `)
      .getMany();
  }

  async removeOutdated(): Promise<{ deletedCount: number }> {
    const result = await this.jobRepo
      .createQueryBuilder()
      .delete()
      .from(JobEntity)
      .where(`
        (deadline IS NOT NULL AND TRIM(deadline) != '' AND 
          CASE 
            WHEN TRIM(deadline) ~ '^\\d{2}/\\d{2}/\\d{4}$' 
            THEN TO_DATE(TRIM(deadline), 'DD/MM/YYYY') < CURRENT_DATE 
            WHEN TRIM(deadline) ~ '^\\d{4}-\\d{2}-\\d{2}'
            THEN TO_DATE(SUBSTRING(TRIM(deadline) FROM 1 FOR 10), 'YYYY-MM-DD') < CURRENT_DATE
            ELSE false 
          END
        )
        OR 
        (
          (deadline IS NULL OR TRIM(deadline) = '') 
          AND (
            "publishDate" IS NOT NULL AND TRIM("publishDate") != '' AND
            CASE 
              WHEN TRIM("publishDate") ~ '^\\d{2}/\\d{2}/\\d{4}$' 
              THEN TO_DATE(TRIM("publishDate"), 'DD/MM/YYYY') < CURRENT_DATE - INTERVAL '1 month'
              WHEN TRIM("publishDate") ~ '^\\d{4}-\\d{2}-\\d{2}'
              THEN TO_DATE(SUBSTRING(TRIM("publishDate") FROM 1 FOR 10), 'YYYY-MM-DD') < CURRENT_DATE - INTERVAL '1 month'
              ELSE false 
            END
          )
        )
      `)
      .execute();

    this.citiesCache = null; // Invalidate cache
    return { deletedCount: result.affected || 0 };
  }

  async hardRemove() {
    const res = await this.jobRepo.clear();
    this.citiesCache = null; // Invalidate cache
    return res;
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

    // 3. Scrape awork.ge fully
    this.logger.log('Step 3: Scraping awork.ge fully...');
    const aworkRes = await this.aworkGeScraperService.scrapeAllJobs();
    const aworkJobs = aworkRes.jobs || [];

    const jobsGeJobs = jobsGeResult?.jobs || [];
    
    // Build set of signatures from jobs.ge and hr.ge to deduplicate awork.ge against them
    const otherSourceSignatures = new Set<string>();
    [...jobsGeJobs, ...hrGeJobs].forEach(job => {
      const v = this.normalizeText(job.vacancy);
      const c = this.normalizeText(job.company);
      if (v && c) {
        otherSourceSignatures.add(`${v}|${c}`);
      }
    });

    // Filter out awork.ge jobs that already exist on jobs.ge or hr.ge
    let aworkDuplicatesCount = 0;
    const filteredAworkJobs = aworkJobs.filter(job => {
      const v = this.normalizeText(job.vacancy);
      const c = this.normalizeText(job.company);
      const isDuplicate = otherSourceSignatures.has(`${v}|${c}`);
      if (isDuplicate) aworkDuplicatesCount++;
      return !isDuplicate;
    });

    const combined = [...jobsGeJobs, ...hrGeJobs, ...filteredAworkJobs];

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
      aworkGeOriginalCount: aworkJobs.length,
      aworkGeDuplicatesRemoved: aworkDuplicatesCount,
      aworkGeFilteredCount: filteredAworkJobs.length,
      aworkGeTotalAvailable: aworkRes.totalAvailable,
      totalCombined: combined.length,
      uniqueCount: uniqueJobs.length,
      jobs: uniqueJobs,
    };
  }

  async scrapeAndSaveAll() {
    this.logger.log('Starting full multi-source scraping (jobs.ge + hr.ge + awork.ge + myjobs.ge) and database save...');

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

    // 3. Scrape awork.ge fully
    this.logger.log('Step 3: Scraping awork.ge fully...');
    const aworkRes = await this.aworkGeScraperService.scrapeAllJobs({
      delayBetweenRequests: 250,
    });
    const aworkJobs = aworkRes.jobs || [];

    // 4. Scrape myjobs.ge fully
    this.logger.log('Step 4: Scraping myjobs.ge fully...');
    const myjobsRes = await this.myjobsGeScraperService.scrapeAllJobs({
      delayBetweenRequests: 250,
    });
    const myjobsJobs = myjobsRes.jobs || [];

    // Fetch existing DB records so DB listings are also checked for cross-source duplicates
    const existingDbJobs = await this.jobRepo.find({
      select: ['vacancy', 'company'],
    });

    // Deduplicate awork.ge and myjobs.ge jobs against jobs.ge, hr.ge, and existing DB listings
    const existingSignatures = new Set<string>();

    existingDbJobs.forEach(job => {
      const v = this.normalizeText(job.vacancy);
      const c = this.normalizeText(job.company);
      if (v && c) {
        existingSignatures.add(`${v}|${c}`);
      }
    });

    [...jobsGeJobs, ...hrGeJobs].forEach(job => {
      const v = this.normalizeText(job.vacancy);
      const c = this.normalizeText(job.company);
      if (v && c) {
        existingSignatures.add(`${v}|${c}`);
      }
    });

    let aworkDuplicatesRemoved = 0;
    const uniqueAworkJobs = aworkJobs.filter(job => {
      const v = this.normalizeText(job.vacancy);
      const c = this.normalizeText(job.company);
      const isDuplicate = existingSignatures.has(`${v}|${c}`);
      if (isDuplicate) aworkDuplicatesRemoved++;
      return !isDuplicate;
    });

    // Add unique awork signatures into set before filtering myjobs
    uniqueAworkJobs.forEach(job => {
      const v = this.normalizeText(job.vacancy);
      const c = this.normalizeText(job.company);
      if (v && c) {
        existingSignatures.add(`${v}|${c}`);
      }
    });

    let myjobsDuplicatesRemoved = 0;
    const uniqueMyjobsJobs = myjobsJobs.filter(job => {
      const v = this.normalizeText(job.vacancy);
      const c = this.normalizeText(job.company);
      const isDuplicate = existingSignatures.has(`${v}|${c}`);
      if (isDuplicate) myjobsDuplicatesRemoved++;
      return !isDuplicate;
    });

    this.logger.log(
      `Multi-source deduplication:
      - Jobs.ge: ${jobsGeJobs.length}
      - HR.ge: ${hrGeJobs.length}
      - Awork: ${aworkJobs.length} scraped (${aworkDuplicatesRemoved} duplicates removed, ${uniqueAworkJobs.length} unique)
      - MyJobs: ${myjobsJobs.length} scraped (${myjobsDuplicatesRemoved} duplicates removed, ${uniqueMyjobsJobs.length} unique)`,
    );

    const combined = [...jobsGeJobs, ...hrGeJobs, ...uniqueAworkJobs, ...uniqueMyjobsJobs];

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
      aworkGeOriginalCount: aworkJobs.length,
      aworkGeDuplicatesRemoved: aworkDuplicatesRemoved,
      aworkGeUniqueCount: uniqueAworkJobs.length,
      myjobsGeOriginalCount: myjobsJobs.length,
      myjobsGeDuplicatesRemoved: myjobsDuplicatesRemoved,
      myjobsGeUniqueCount: uniqueMyjobsJobs.length,
      totalCombined: combined.length,
      uniqueCount: uniqueJobs.length,
      uniqueInsertedCount: uniqueJobs.length,
      message: 'Successfully scraped from all 4 sources (jobs.ge, hr.ge, awork.ge, myjobs.ge), deduplicated, and inserted unique jobs into database. Description enrichment is running in the background.',
      jobs: uniqueJobs,
    };
  }

  /**
   * Scrapes awork.ge and checks each vacancy against existing database jobs / jobs.ge / hr.ge,
   * identifying and returning any duplicate postings found.
   */
  async checkAworkDuplicatesAgainstOtherSources() {
    this.logger.log('Checking awork.ge vacancies against jobs.ge and hr.ge...');

    const aworkRes = await this.aworkGeScraperService.scrapeAllJobs();
    const aworkJobs = aworkRes.jobs || [];

    // Fetch existing jobs from DB or scrape jobs.ge/hr.ge
    const existingDbJobs = await this.jobRepo.find({
      select: ['vacancy', 'company', 'location', 'link'],
    });

    const dbSignatures = new Set<string>();
    existingDbJobs.forEach(job => {
      const v = this.normalizeText(job.vacancy);
      const c = this.normalizeText(job.company);
      if (v && c) {
        dbSignatures.add(`${v}|${c}`);
      }
    });

    const duplicates: { aworkJob: JobData; matchedSignature: string }[] = [];
    const uniqueAworkJobs: JobData[] = [];

    aworkJobs.forEach(job => {
      const v = this.normalizeText(job.vacancy);
      const c = this.normalizeText(job.company);
      const sig = `${v}|${c}`;

      if (dbSignatures.has(sig)) {
        duplicates.push({ aworkJob: job, matchedSignature: sig });
      } else {
        uniqueAworkJobs.push(job);
      }
    });

    return {
      totalAworkJobsScraped: aworkJobs.length,
      duplicateCountFoundOnOtherSources: duplicates.length,
      uniqueAworkJobsRemainingCount: uniqueAworkJobs.length,
      duplicates,
      uniqueAworkJobs,
    };
  }

  async enrichMissingDescriptionsInBackground() {
    this.logger.log('Starting background description enrichment...');
    
    // Find all jobs with empty/null descriptions or placeholder links
    const jobsToEnrich = await this.jobRepo
      .createQueryBuilder('job')
      .where('job.description IS NULL OR job.description = :empty OR job.description LIKE :shortDesc OR job.description LIKE :srLink', { 
        empty: '',
        shortDesc: '%დეტალური ინფორმაციისთვის გადადით ბმულზე%',
        srLink: '%smartrecruiters.com%'
      })
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
          } else if (job.link.includes('myjobs.ge')) {
            const parts = job.link.split('/');
            const id = parseInt(parts[parts.length - 1], 10);
            if (!isNaN(id)) {
              desc = await this.myjobsGeScraperService.fetchDescription(id);
            }
          } else if (job.description && job.description.includes('smartrecruiters.com')) {
            desc = await this.myjobsGeScraperService.fetchSmartRecruitersDescription(job.description);
          }

          if (desc && desc.trim().length > 0 && desc.trim() !== job.description) {
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
