import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { Brackets, ILike, In, LessThan, Like, Repository } from 'typeorm';
import { JobEntity } from 'src/Entities/job.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { title } from 'process';
import { FilterJobDto } from './dto/filter-job.dto';
import { ScraperService } from 'src/Schedulers/scrapper.service';

@Injectable()
export class JobService {
  constructor(private scraperService: ScraperService, @InjectRepository(JobEntity) private jobRepo: Repository<JobEntity>) {

  }
  async create(createJobDto: CreateJobDto) {
    const job = await await this.jobRepo.save(createJobDto);
    return job;
  }

  async scrapper() {
    await this.scraperService.scrapeJobs('', 1, {
      maxPages: 17
    });
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
    qb.where('job.archived = :archived', { archived: false });

    let hasFilter = false;

    if (query && query.length > 0) {
      hasFilter = true;

      qb.andWhere(
        new Brackets((qb2) => {
          query.forEach((val, i) => {
            const param = `query${i}`;
            if (i === 0) {
              qb2.where(`LOWER(job.vacancy) LIKE :${param}`, { [param]: `%${val.toLowerCase()}%` });
            } else {
              qb2.orWhere(`LOWER(job.vacancy) LIKE :${param}`, { [param]: `%${val.toLowerCase()}%` });
            }
          });
        })
      );
    }

    const [jobs, filteredRecords] = await qb.take(limit).skip(skip).getManyAndCount();
    const totalRecords = await this.jobRepo.count({ where: { archived: false } });

    return {
      jobs,
      counts: {
        totalRecords,
        filteredRecords: hasFilter ? filteredRecords : totalRecords
      },
      page,
      limit
    };
  }

  async findAllByQuery(query: string | string[]) {
    const queries = (Array.isArray(query) ? query : [query])
      .filter((q) => typeof q === 'string' && q.trim().length > 0);

    if (queries.length === 0) {
      return [];
    }

    const qb = this.jobRepo.createQueryBuilder('job');

    qb.where('job.archived = false')
      .andWhere(
        new Brackets((qb2) => {
          queries.forEach((q, index) => {
            const param = `q${index}`;

            if (index === 0) {
              qb2.where(`LOWER(job.vacancy) LIKE :${param}`, {
                [param]: `%${q.toLowerCase()}%`,
              });
            } else {
              qb2.orWhere(`LOWER(job.vacancy) LIKE :${param}`, {
                [param]: `%${q.toLowerCase()}%`,
              });
            }
          });
        }),
      );

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

  async removeOutDated(): Promise<void> {
    console.log("removed");

    await this.jobRepo
      .createQueryBuilder()
      .update()
      .set({ archived: true })
      .where('archived = false')
      .andWhere('deadline IS NOT NULL')
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
      maxJobs: 100,
      delayBetweenRequests: 2000,
      maxPages: 17
    });
  }
}
