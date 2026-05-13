import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { Brackets, ILike, In, LessThan, Like, Repository } from 'typeorm';
import { JobEntity } from 'src/Entities/job.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { title } from 'process';
import { FilterJobDto } from './dto/filter-job.dto';
import { ScraperService } from 'src/Schedulers/jobs-ge.scraper';
import { HR_GE_ScraperService } from 'src/Schedulers/hr-ge.scraper';

@Injectable()
export class JobService {
  constructor(private scraperService: ScraperService, private hrScraperService: HR_GE_ScraperService, @InjectRepository(JobEntity) private jobRepo: Repository<JobEntity>) {

  }
  async create(createJobDto: CreateJobDto) {
    const job = await this.jobRepo.save(createJobDto);
    return job;
  }

  async scrapper() {
    await this.scraperService.scrapeJobs('', 1, {
      fetchDescriptions: true,
      descriptionDelay: 1500,      // 1.5s between each detail page
      descriptionBatchSize: 10,
      maxPages: 17
    });
  }

  async hr_ge_scrapper() {
    await this.hrScraperService.scrapeJobs();
  }
  async insertMany(createJobDto: CreateJobDto[]) {
    await this.jobRepo
      .createQueryBuilder()
      .insert()
      .into(JobEntity)
      .values(createJobDto)
      .orIgnore() // <-- skips duplicates based on the unique 'link' column
      .execute();
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
    await this.scraperService.scrapeJobs('', 1, {
      fetchDescriptions: true,
      descriptionDelay: 1500,      // 1.5s between each detail page
      descriptionBatchSize: 10,
      maxPages: 1
    });
  }
}
