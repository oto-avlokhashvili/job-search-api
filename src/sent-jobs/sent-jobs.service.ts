import { Injectable } from '@nestjs/common';
import { CreateSentJobDto } from './dto/create-sent-job.dto';
import { UpdateSentJobDto } from './dto/update-sent-job.dto';
import { SentJob } from 'src/Entities/sent-jobs.entity';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';

@Injectable()
export class SentJobsService {
  constructor(@InjectRepository(SentJob) private sentJobRepo: Repository<SentJob>){}
  async create(createSentJobDto: CreateSentJobDto) {

    const sentJob = await this.sentJobRepo.save(createSentJobDto);
    return sentJob;
  }

  findAll() {
    return `This action returns all sentJobs`;
  }

async findByUserId(id: number, page = 1) {
  const take = 10;
  const skip = (page - 1) * take;

  const qb = this.sentJobRepo
    .createQueryBuilder('sentJob')
    .leftJoinAndSelect('sentJob.job', 'job')
    .where('sentJob.userId = :id', { id })
    .orderBy('sentJob.id', 'DESC')
    .take(take)
    .skip(skip);

  const [sentJobs, count] = await qb.getManyAndCount();

  return {
    sentJobs,
    count,
    page,
    totalPages: Math.ceil(count / take),
  };
}

  /** Returns ALL sent job IDs for a user — no pagination, used for dedup checks */
  async findAllJobIdsByUserId(id: number): Promise<number[]> {
    const rows = await this.sentJobRepo
      .createQueryBuilder('sentJob')
      .select('sentJob.jobId')
      .where('sentJob.userId = :id', { id })
      .getRawMany();
    return rows.map(r => r.sentJob_jobId);
  }

  findOne(id: number) {
    return `This action returns a #${id} sentJob`;
  }

  update(id: number, updateSentJobDto: UpdateSentJobDto) {
    return `This action updates a #${id} sentJob`;
  }

  remove(id: number) {
    return `This action removes a #${id} sentJob`;
  }
}
