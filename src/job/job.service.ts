import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { ILike, Like, Repository } from 'typeorm';
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

  async scrapper(){
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
      .execute();
  }

  async findAll(filterDto: FilterJobDto) {
    const { vacancy, page = 1, limit = 20 } = filterDto;
    const skip = (page - 1) * limit;

    if (vacancy) {
      return await this.jobRepo
        .createQueryBuilder('job')
        .where('LOWER(job.vacancy) LIKE LOWER(:vacancy)', {
          vacancy: `%${vacancy}%`,
        })
        .take(limit)
        .skip(skip)
        .getManyAndCount();
    }

    return await this.jobRepo.findAndCount({
      take: limit,
      skip: skip
    });
  }
  async findAllByQuery(query: string) {
    return await this.jobRepo
      .createQueryBuilder('job')
      .where('LOWER(job.vacancy) LIKE :q', {
        q: `%${query.toLowerCase()}%`,
      })
      .getMany();
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

  hardRemove() {
    return this.jobRepo.clear();
  }

  async manualScrapper(){
    await this.scraperService.scrapeJobs('', 1, {
            maxJobs: 100,
            delayBetweenRequests: 2000,
            maxPages: 17
        });
  }
}
