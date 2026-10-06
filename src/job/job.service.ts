import { Injectable, NotFoundException, Logger, ConflictException } from '@nestjs/common';
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { Brackets, ILike, In, LessThan, Like, Repository } from 'typeorm';
import { JobEntity } from 'src/Entities/job.entity';
import { ScrapedJobEntity } from 'src/Entities/scraped-job.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { FilterJobDto } from './dto/filter-job.dto';
import { JobsGeScraperService, JobData } from '../scrapers/jobs-ge.scraper';
import { HrGeScraperService } from '../scrapers/hr-ge-scraper.service';
import { AworkGeScraperService } from '../scrapers/awork-ge.scraper';
import { MyjobsGeScraperService } from '../scrapers/myjobs-ge.scraper';
import { LinkedinScraperService, LinkedinScraperOptions } from '../scrapers/linkedin.scraper';
import * as crypto from 'crypto';

export interface LinkedinDuplicateCheckResult {
  nonDuplicatedJobs: JobData[];
  nonDuplicatedCount: number;
  duplicatesCount: number;
  totalScraped: number;
  comparedAgainstCount: number;
  insertedToDbCount: number;
  savedToDb: boolean;
  duplicates: {
    linkedinJob: JobData;
    matchedWith?: any;
    matchedSignature: string;
    reason: string;
  }[];
  jobs: JobData[];
  totalJobs: number;
}

export type ScrapeSource = 'hrge' | 'jobsge' | 'awork' | 'myjobs' | 'linkedin';

export const SCRAPE_SOURCE_PRIORITY: ScrapeSource[] = ['hrge', 'jobsge', 'awork', 'myjobs', 'linkedin'];

export interface ScrapeSourceResult {
  source: ScrapeSource;
  scraped: number;
}

export interface MergeSourceResult {
  source: ScrapeSource;
  staged: number;
  duplicatesRemoved: number;
  inserted: number;
}

export interface MergeResult {
  runId: string;
  totalInserted: number;
  perSource: MergeSourceResult[];
}

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

export function getSearchVariants(term: string): string[] {
  const t = term.trim().toLowerCase();
  if (!t) return [];
  const variants = new Set<string>([t]);

  // Georgian suffixes
  if (/[ა-ჰ]/.test(t)) {
    const georgianSuffixes = [
      'ების', 'ებით', 'ებად', 'ებს', 'ები',
      'ური', 'ული', 'ის', 'ით', 'ად', 'მა', 'ზე', 'ში', 'ი'
    ];
    for (const suffix of georgianSuffixes) {
      if (t.endsWith(suffix) && t.length - suffix.length >= 3) {
        variants.add(t.slice(0, -suffix.length));
        break; // Only strip the longest matching suffix
      }
    }
  } else {
    // English suffixes
    const englishSuffixes = ['ies', 'ing', 'ers', 'er', 'ed', 'es', 's'];
    for (const suffix of englishSuffixes) {
      if (t.endsWith(suffix) && t.length - suffix.length >= 3) {
        variants.add(t.slice(0, -suffix.length));
        break;
      }
    }
  }

  return Array.from(variants);
}

export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildWordBoundaryRegex(term: string): string {
  const variants = getSearchVariants(term);
  const escaped = variants.map(escapeRegex).join('|');
  return `(^|[^a-zA-Z0-9\u10A0-\u10FF])(${escaped})`;
}

@Injectable()
export class JobService {
  private readonly logger = new Logger(JobService.name);
  private citiesCache: { location: string; count: number }[] | null = null;

  constructor(
    private readonly scraperService: JobsGeScraperService,
    private readonly hrGeScraperService: HrGeScraperService,
    private readonly aworkGeScraperService: AworkGeScraperService,
    private readonly myjobsGeScraperService: MyjobsGeScraperService,
    private readonly linkedinScraperService: LinkedinScraperService,
    @InjectRepository(JobEntity) 
    private readonly jobRepo: Repository<JobEntity>,
    @InjectRepository(ScrapedJobEntity)
    private readonly scrapedJobRepo: Repository<ScrapedJobEntity>
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
    createJobDto.page ??= 1;
    try {
      const job = await this.jobRepo.save(createJobDto);
      this.citiesCache = null; // Invalidate cache
      return job;
    } catch (err: any) {
      if (err?.code === '23505') { // unique_violation (link or fingerprint)
        throw new ConflictException('A job with the same link or fingerprint already exists');
      }
      throw err;
    }
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
      const rawTerms = trimmedQuery.split(/\s+/).filter((t) => t.length > 0);

      const termRegexParams: string[] = [];
      rawTerms.forEach((term, i) => {
        const param = `termRegex${i}`;
        qb.setParameter(param, buildWordBoundaryRegex(term));
        termRegexParams.push(param);
      });

      const hasPhrase = rawTerms.length > 1;
      if (hasPhrase) {
        qb.setParameter('phraseRegex', `(^|[^a-zA-Z0-9\u10A0-\u10FF])(${escapeRegex(trimmedQuery)})`);
        qb.setParameter('wholePhraseLike', `%${trimmedQuery}%`);
      }

      // WHERE clause ensures at least one term matches with word boundary
      qb.andWhere(
        new Brackets((qb2) => {
          termRegexParams.forEach((param, i) => {
            const cond = `(job.vacancy ~* :${param} OR job.company ~* :${param} OR job.description ~* :${param})`;
            if (i === 0) {
              qb2.where(cond);
            } else {
              qb2.orWhere(cond);
            }
          });
        })
      );

      // Conditions for determining tier membership
      const titleConds = termRegexParams.map((p) => `job.vacancy ~* :${p}`).join(' OR ');
      const companyConds = termRegexParams.map((p) => `job.company ~* :${p}`).join(' OR ');

      // Boost clauses
      const boostClauses: string[] = [];

      if (hasPhrase) {
        boostClauses.push(
          `CASE WHEN job.vacancy ~* :phraseRegex OR LOWER(job.vacancy) LIKE :wholePhraseLike THEN 50000 ELSE 0 END`,
          `CASE WHEN job.company ~* :phraseRegex OR LOWER(job.company) LIKE :wholePhraseLike THEN 500 ELSE 0 END`,
          `CASE WHEN job.description ~* :phraseRegex OR LOWER(job.description) LIKE :wholePhraseLike THEN 10 ELSE 0 END`
        );
      }

      termRegexParams.forEach((param) => {
        boostClauses.push(
          `CASE WHEN job.vacancy ~* :${param} THEN 5000 ELSE 0 END`,
          `CASE WHEN job.company ~* :${param} THEN 50 ELSE 0 END`,
          `CASE WHEN job.description ~* :${param} THEN 1 ELSE 0 END`
        );
      });

      // Priority ordering:
      // 1. Vacancy Title Match (Base 1,000,000 pts)
      // 2. Company Name Match (Base 10,000 pts)
      // 3. Description Match (Base 100 pts)
      const orderScoreSql = `(
        CASE 
          WHEN (${titleConds}) THEN 1000000
          WHEN (${companyConds}) THEN 10000
          ELSE 100
        END + (${boostClauses.join(' + ')})
      )`;

      qb.orderBy(orderScoreSql, 'DESC');
      qb.addOrderBy('job.id', 'DESC');
    } else {
      qb.orderBy('job.id', 'DESC');
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
        qb.andWhere('job.link LIKE :sourcePattern', { sourcePattern: '%jobs.ge%' })
          .andWhere('job.link NOT LIKE :notMyjobsPattern', { notMyjobsPattern: '%myjobs%' });
      } else if (lowerSource === 'myjobs' || lowerSource === 'myjobs.ge' || lowerSource === 'myjobsge') {
        qb.andWhere('job.link LIKE :sourcePattern', { sourcePattern: '%myjobs%' });
      } else if (lowerSource === 'linkedin' || lowerSource === 'linkedin.com' || lowerSource === 'linkedinge') {
        qb.andWhere('job.link LIKE :sourcePattern', { sourcePattern: '%linkedin%' });
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

    const totalJobsGe = await this.jobRepo
      .createQueryBuilder('job')
      .where('job.link LIKE :jobsGe', { jobsGe: '%jobs.ge%' })
      .andWhere('job.link NOT LIKE :myjobs', { myjobs: '%myjobs%' })
      .getCount();

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

    const totalLinkedin = await this.jobRepo.count({
      where: { link: Like('%linkedin%') },
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
        linkedin: totalLinkedin,
      },
      page,
      limit,
    };
  }

  async findAllByQuery(query: string | string[]) {
    const rawQueries = (Array.isArray(query) ? query : [query])
      .filter((q) => typeof q === 'string' && q.trim().length > 0);

    if (rawQueries.length === 0) return [];

    const qb = this.jobRepo.createQueryBuilder('job');

    const phrases: string[] = [];
    const termSet = new Set<string>();

    const expandTermVariants = (t: string): string[] => {
      const variants = new Set<string>([t]);
      if (t.includes('-')) {
        variants.add(t.replace(/-/g, ''));
        variants.add(t.replace(/-/g, ' '));
      } else {
        if (t === 'frontend') variants.add('front-end');
        if (t === 'backend') variants.add('back-end');
        if (t === 'fullstack') variants.add('full-stack');
      }
      return Array.from(variants);
    };

    for (const raw of rawQueries) {
      const trimmed = raw.trim().toLowerCase();
      if (!trimmed) continue;

      // Add original phrase and hyphen variants if applicable
      phrases.push(trimmed);
      for (const variant of expandTermVariants(trimmed)) {
        if (!phrases.includes(variant)) phrases.push(variant);
      }

      const terms = trimmed.split(/[\s,]+/).filter((t) => t.length > 0);
      for (const term of terms) {
        for (const variant of expandTermVariants(term)) {
          termSet.add(variant);
        }
      }
    }

    const uniqueTerms = Array.from(termSet);
    if (uniqueTerms.length === 0) return [];

    const termRegexParams: string[] = [];
    uniqueTerms.forEach((term, i) => {
      const param = `searchTerm${i}`;
      qb.setParameter(param, buildWordBoundaryRegex(term));
      termRegexParams.push(param);
    });

    const phraseRegexParams: string[] = [];
    phrases.forEach((phrase, i) => {
      const param = `wholePhrase${i}`;
      const likeParam = `wholePhraseLike${i}`;
      qb.setParameter(param, `(^|[^a-zA-Z0-9\u10A0-\u10FF])(${escapeRegex(phrase)})`);
      qb.setParameter(likeParam, `%${phrase}%`);
      phraseRegexParams.push(param);
    });

    // WHERE clause matches any term with word boundary
    qb.where(
      new Brackets((qb2) => {
        termRegexParams.forEach((param, i) => {
          const cond = `(job.vacancy ~* :${param} OR job.company ~* :${param} OR job.description ~* :${param})`;
          if (i === 0) {
            qb2.where(cond);
          } else {
            qb2.orWhere(cond);
          }
        });
      })
    );

    const titleConds = termRegexParams.map((p) => `job.vacancy ~* :${p}`).join(' OR ');
    const companyConds = termRegexParams.map((p) => `job.company ~* :${p}`).join(' OR ');

    const boostClauses: string[] = [];

    // 1. Whole phrase boosts
    phrases.forEach((_, i) => {
      const phraseParam = `wholePhrase${i}`;
      const likeParam = `wholePhraseLike${i}`;
      boostClauses.push(
        `CASE WHEN job.vacancy ~* :${phraseParam} OR LOWER(job.vacancy) LIKE :${likeParam} THEN 50000 ELSE 0 END`,
        `CASE WHEN job.company ~* :${phraseParam} OR LOWER(job.company) LIKE :${likeParam} THEN 500 ELSE 0 END`,
        `CASE WHEN job.description ~* :${phraseParam} OR LOWER(job.description) LIKE :${likeParam} THEN 10 ELSE 0 END`
      );
    });

    // 2. Individual term boosts
    termRegexParams.forEach((param) => {
      boostClauses.push(
        `CASE WHEN job.vacancy ~* :${param} THEN 5000 ELSE 0 END`,
        `CASE WHEN job.company ~* :${param} THEN 50 ELSE 0 END`,
        `CASE WHEN job.description ~* :${param} THEN 1 ELSE 0 END`
      );
    });

    // Priority ordering: Title > Company > Description
    const orderScoreSql = `(
      CASE 
        WHEN (${titleConds}) THEN 1000000
        WHEN (${companyConds}) THEN 10000
        ELSE 100
      END + (${boostClauses.join(' + ')})
    )`;

    qb.andWhere(`${orderScoreSql} >= 100`);
    qb.orderBy(orderScoreSql, 'DESC');
    qb.addOrderBy('job.id', 'DESC');
    qb.limit(60);

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

  /**
   * Maps free-text location (any language, district names, "Tbilisi, Georgia") to a canonical city
   * from CITY_MAPPING. Returns '' when no known city is found (e.g. "Georgia", "Remote", empty).
   */
  private canonicalCity(location?: string | null): string {
    const text = this.normalizeText(location || '');
    if (!text) return '';
    for (const [city, keywords] of Object.entries(CITY_MAPPING)) {
      if (keywords.some((k) => {
        const kw = this.normalizeText(k);
        return kw && text.includes(kw);
      })) {
        return city;
      }
    }
    return '';
  }

  /**
   * A job counts as already seen when the same vacancy|company exists in the same city. If either side
   * has no recognizable city, the city can't distinguish them, so it counts as a match.
   */
  private isSeen(cities: Set<string> | undefined, city: string): boolean {
    if (!cities) return false;
    return !city || cities.has(city) || cities.has('');
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

  /**
   * Scrapes a single source and stages the raw results in `scraped_job_entity` under the given run.
   * Nothing is written to the job table here; `mergeStagedJobs` dedupes across sources and the DB
   * once every source has finished, so sources can scrape in parallel.
   * Re-running a source for the same run replaces its previously staged rows (safe for retries).
   */
  async scrapeSourceToStaging(source: ScrapeSource, runId: string): Promise<ScrapeSourceResult> {
    this.logger.log(`Scraping source "${source}" (run ${runId})...`);

    let jobs: JobData[] = [];
    switch (source) {
      case 'hrge':
        jobs = await this.hrGeScraperService.scrapeAllJobs(1, {
          fetchDescriptions: false,
          delayBetweenRequests: 250,
        });
        break;
      case 'jobsge':
        jobs = (await this.scraperService.scrapeJobs('', 1, { fetchDescriptions: false }))?.jobs || [];
        break;
      case 'awork':
        jobs = (await this.aworkGeScraperService.scrapeAllJobs({ delayBetweenRequests: 250 })).jobs || [];
        break;
      case 'myjobs':
        jobs = (await this.myjobsGeScraperService.scrapeAllJobs({ delayBetweenRequests: 250 })).jobs || [];
        break;
      case 'linkedin':
        jobs = (await this.linkedinScraperService.scrapeAllGeorgiaJobs({ fetchDescriptions: false })).jobs || [];
        break;
      default:
        throw new Error(`Unknown scrape source "${source}"`);
    }

    await this.scrapedJobRepo.delete({ runId, source });

    const chunkSize = 500;
    for (let i = 0; i < jobs.length; i += chunkSize) {
      await this.scrapedJobRepo.insert(
        jobs.slice(i, i + chunkSize).map((job) => ({
          runId,
          source,
          vacancy: job.vacancy,
          location: job.location,
          company: job.company,
          link: job.link,
          publishDate: job.publishDate,
          deadline: job.deadline,
          page: job.page,
          description: job.description || null,
        })),
      );
    }

    const result: ScrapeSourceResult = { source, scraped: jobs.length };
    this.logger.log(`Source "${source}" staged: ${jobs.length} jobs`);
    return result;
  }

  /**
   * Merges all sources staged for a run into the job table.
   * Sources are processed in priority order. Each source is deduped (vacancy|company|city) against the
   * existing DB jobs and every higher-priority source, but not against itself, so multi-location
   * postings inside one source are preserved. Same title and company in a different city is a new job. Within a source, duplicates are collapsed by fingerprint.
   */
  async mergeStagedJobs(runId: string): Promise<MergeResult> {
    // Housekeeping: drop staging rows left behind by runs that never finished merging
    await this.scrapedJobRepo.delete({ createdAt: LessThan(new Date(Date.now() - 3 * 24 * 3600 * 1000)) });

    const existing = await this.jobRepo.find({ select: ['vacancy', 'company', 'location'] });
    const seen = new Map<string, Set<string>>();
    const markSeen = (signature: string, city: string) => {
      const cities = seen.get(signature);
      if (cities) cities.add(city);
      else seen.set(signature, new Set([city]));
    };
    for (const job of existing) {
      const v = this.normalizeText(job.vacancy);
      const c = this.normalizeText(job.company);
      if (v && c) markSeen(`${v}|${c}`, this.canonicalCity(job.location));
    }

    const perSource: MergeSourceResult[] = [];
    let totalInserted = 0;

    for (const source of SCRAPE_SOURCE_PRIORITY) {
      const staged = await this.scrapedJobRepo.find({ where: { runId, source } });
      if (staged.length === 0) continue;

      let duplicatesRemoved = 0;
      const byFingerprint = new Map<string, CreateJobDto>();
      const sourceSeen: { signature: string; city: string }[] = [];

      for (const row of staged) {
        const v = this.normalizeText(row.vacancy);
        const c = this.normalizeText(row.company);
        const signature = `${v}|${c}`;
        const city = this.canonicalCity(row.location);
        if (v && c && this.isSeen(seen.get(signature), city)) {
          duplicatesRemoved++;
          continue;
        }

        const fingerprint = crypto
          .createHash('md5')
          .update(`${v}|${c}|${this.normalizeText(row.location)}`)
          .digest('hex');
        const current = byFingerprint.get(fingerprint);
        if (!current || (row.description || '').length > (current.description || '').length) {
          byFingerprint.set(fingerprint, {
            vacancy: row.vacancy,
            location: row.location,
            company: row.company,
            link: row.link,
            publishDate: row.publishDate,
            deadline: row.deadline,
            page: row.page,
            description: row.description ?? undefined,
            fingerprint,
          } as CreateJobDto);
        }
        if (v && c) sourceSeen.push({ signature, city });
      }

      // Later sources must see this source's jobs, but this source must not dedupe against itself
      for (const { signature, city } of sourceSeen) markSeen(signature, city);

      const uniqueJobs = Array.from(byFingerprint.values());
      if (uniqueJobs.length > 0) await this.insertMany(uniqueJobs);

      totalInserted += uniqueJobs.length;
      perSource.push({ source, staged: staged.length, duplicatesRemoved, inserted: uniqueJobs.length });
    }

    await this.scrapedJobRepo.delete({ runId });
    this.logger.log(`Merge for run ${runId} done: ${JSON.stringify(perSource)}`);
    return { runId, totalInserted, perSource };
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

  /**
   * Scrapes LinkedIn jobs for Georgia, compares each job against existing database jobs,
   * and filters out duplicates based on normalized vacancy title and company name signatures.
   */
  async scrapeAndDeduplicateLinkedin(
    options: LinkedinScraperOptions & { saveToDb?: boolean; jobsToCompareAgainst?: JobData[] } = {},
  ): Promise<LinkedinDuplicateCheckResult> {
    this.logger.log('Starting LinkedIn scrape and deduplication against other job sources...');

    // 1. Scrape LinkedIn (use targeted scrapeJobs if location or page limits specified, otherwise multi-region all Georgia)
    const hasSpecificLocationOrPages = Boolean(options.location || options.startPage || options.maxPages);
    const linkedinRes = hasSpecificLocationOrPages
      ? await this.linkedinScraperService.scrapeJobs({
          keywords: options.keywords,
          location: options.location,
          startPage: options.startPage,
          maxPages: options.maxPages,
          delayBetweenRequests: options.delayBetweenRequests,
          fetchDescriptions: options.fetchDescriptions ?? false,
          descriptionLimit: options.descriptionLimit,
        })
      : await this.linkedinScraperService.scrapeAllGeorgiaJobs({
          keywords: options.keywords,
          maxPagesPerRegion: options.maxPagesPerRegion ?? 30,
          fetchDescriptions: options.fetchDescriptions ?? false,
          descriptionLimit: options.descriptionLimit,
        });

    const linkedinJobs = linkedinRes.jobs || [];
    this.logger.log(`Scraped ${linkedinJobs.length} jobs from LinkedIn. Now checking for duplicates...`);

    // 2. Fetch existing database jobs to compare against
    const existingDbJobs = await this.jobRepo.find({
      select: ['id', 'vacancy', 'company', 'location', 'link'],
    });

    // 3. Build lookup maps/sets for existing jobs
    const existingSignatures = new Map<string, any>();
    const existingLinks = new Set<string>();

    const registerJob = (
      job: { vacancy?: string; company?: string; link?: string; location?: string; id?: number },
      source: string,
    ) => {
      if (job.link) {
        existingLinks.add(job.link.split('?')[0].trim().toLowerCase());
      }
      const v = this.normalizeText(job.vacancy || '');
      const c = this.normalizeText(job.company || '');
      if (v && c) {
        const sig = `${v}|${c}`;
        if (!existingSignatures.has(sig)) {
          existingSignatures.set(sig, {
            source,
            id: job.id,
            vacancy: job.vacancy,
            company: job.company,
            location: job.location,
            link: job.link,
          });
        }
      }
    };

    existingDbJobs.forEach((job) => registerJob(job, 'database'));

    if (options.jobsToCompareAgainst && options.jobsToCompareAgainst.length > 0) {
      options.jobsToCompareAgainst.forEach((job) => registerJob(job, 'provided_baseline'));
    }

    // 4. Deduplicate LinkedIn jobs against existing baseline + within-batch duplicates
    const duplicates: {
      linkedinJob: JobData;
      matchedWith?: any;
      matchedSignature: string;
      reason: string;
    }[] = [];
    const nonDuplicatedJobs: JobData[] = [];
    const seenBatchSignatures = new Set<string>();

    for (const job of linkedinJobs) {
      const cleanLink = (job.link || '').split('?')[0].trim().toLowerCase();
      const v = this.normalizeText(job.vacancy);
      const c = this.normalizeText(job.company);
      const sig = `${v}|${c}`;

      // Check duplicate by exact link
      if (cleanLink && existingLinks.has(cleanLink)) {
        duplicates.push({
          linkedinJob: job,
          matchedWith: { link: cleanLink },
          matchedSignature: sig,
          reason: 'Exact link match with existing job',
        });
        continue;
      }

      // Check duplicate by normalized vacancy and company
      if (existingSignatures.has(sig)) {
        const matched = existingSignatures.get(sig);
        duplicates.push({
          linkedinJob: job,
          matchedWith: matched,
          matchedSignature: sig,
          reason: `Matched ${matched.source || 'existing'} job with same vacancy title and company`,
        });
        continue;
      }

      // Check duplicate within the current LinkedIn batch
      if (seenBatchSignatures.has(sig)) {
        duplicates.push({
          linkedinJob: job,
          matchedWith: { source: 'linkedin_current_batch' },
          matchedSignature: sig,
          reason: 'Duplicate within current LinkedIn scrape batch',
        });
        continue;
      }

      seenBatchSignatures.add(sig);
      nonDuplicatedJobs.push(job);
    }

    const comparedAgainstCount = existingDbJobs.length + (options.jobsToCompareAgainst?.length || 0);

    const shouldSaveToDb = options.saveToDb !== false;
    let insertedToDbCount = 0;

    if (shouldSaveToDb && nonDuplicatedJobs.length > 0) {
      this.logger.log(`Inserting ${nonDuplicatedJobs.length} non-duplicated LinkedIn jobs into the database...`);
      await this.insertMany(nonDuplicatedJobs);
      insertedToDbCount = nonDuplicatedJobs.length;
      this.logger.log(`Insertion completed successfully! Saved ${insertedToDbCount} LinkedIn jobs into the database.`);
    }

    this.logger.log(
      `LinkedIn deduplication complete:
      - Total LinkedIn Scraped: ${linkedinJobs.length}
      - Compared Against: ${comparedAgainstCount} jobs
      - Non-duplicated (Unique): ${nonDuplicatedJobs.length}
      - Duplicates Found: ${duplicates.length}
      - Saved to Database: ${shouldSaveToDb} (${insertedToDbCount} inserted)`,
    );

    return {
      nonDuplicatedJobs,
      nonDuplicatedCount: nonDuplicatedJobs.length,
      duplicatesCount: duplicates.length,
      totalScraped: linkedinJobs.length,
      comparedAgainstCount,
      insertedToDbCount,
      savedToDb: shouldSaveToDb,
      duplicates,
      jobs: nonDuplicatedJobs,
      totalJobs: nonDuplicatedJobs.length,
    };
  }

  /**
   * Ids of jobs with empty/placeholder descriptions that still need enrichment (awork.ge excluded).
   */
  async getJobIdsNeedingEnrichment(): Promise<number[]> {
    const rows = await this.jobRepo
      .createQueryBuilder('job')
      .select('job.id', 'id')
      .where('(job.description IS NULL OR job.description = :empty OR job.description LIKE :shortDesc OR job.description LIKE :srLink) AND job.link NOT LIKE :aworkLink', {
        aworkLink: '%awork.ge%', // awork returns descriptions with the listing, nothing to fetch later
        empty: '',
        shortDesc: '%დეტალური ინფორმაციისთვის გადადით ბმულზე%',
        srLink: '%smartrecruiters.com%',
      })
      .getRawMany<{ id: number }>();
    return rows.map((r) => r.id);
  }

  /**
   * Fetches and stores the description for a single job. Returns true when a new description was saved.
   * Throws on fetch errors so the queue can retry.
   */
  async enrichJobDescription(jobId: number): Promise<boolean> {
    const job = await this.jobRepo.findOne({
      where: { id: jobId },
      select: ['id', 'link', 'description'],
    });
    if (!job) return false;

    const desc = await this.fetchDescriptionForJob(job);
    if (desc && desc.trim().length > 0 && desc.trim() !== job.description) {
      await this.jobRepo.update(job.id, { description: desc.trim() });
      return true;
    }
    return false;
  }

  private async fetchDescriptionForJob(job: Pick<JobEntity, 'link' | 'description'>): Promise<string> {
    const link = job.link || '';
    if (link.includes('hr.ge') || link.includes('cv.ge') || link.includes('doctor.ge') || link.includes('chefs.ge')) {
      const parts = link.split('/');
      const id = parseInt(parts[parts.length - 1], 10);
      if (isNaN(id)) return '';
      let tenantId = 1;
      if (link.includes('cv.ge')) tenantId = 2;
      else if (link.includes('doctor.ge')) tenantId = 4;
      else if (link.includes('chefs.ge')) tenantId = 5;
      return this.hrGeScraperService.fetchDescription(tenantId, id);
    }
    if (link.includes('myjobs.ge') || link.includes('myjobs')) {
      const parts = link.split('/');
      const id = parseInt(parts[parts.length - 1], 10);
      return isNaN(id) ? '' : this.myjobsGeScraperService.fetchDescription(id);
    }
    if (link.includes('jobs.ge')) {
      return this.scraperService.fetchDescription(link);
    }
    if (link.includes('linkedin.com') || link.includes('linkedin')) {
      const match = link.match(/-(\d+)(?:\?|$)/) || link.match(/\/(\d+)(?:\?|$)/);
      return match ? this.linkedinScraperService.fetchJobDescription(match[1]) : '';
    }
    if (job.description && job.description.includes('smartrecruiters.com')) {
      return this.myjobsGeScraperService.fetchSmartRecruitersDescription(job.description);
    }
    return '';
  }
}
