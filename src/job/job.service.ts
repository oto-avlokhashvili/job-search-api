import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { Like, Repository } from 'typeorm';
import { JobEntity } from 'src/Entities/job.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { title } from 'process';

@Injectable()
export class JobService {
  constructor(@InjectRepository(JobEntity) private jobRepo: Repository<JobEntity>) {

  }
  async create(createJobDto: CreateJobDto) {
    const job = await await this.jobRepo.save(createJobDto);
    return job;
  }

  async findAll() {
    const jobs = await this.jobRepo.find();
    return jobs;
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
}
