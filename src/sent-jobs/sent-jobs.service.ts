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

async findByUserId(id: number, page = 1, limit = 10) {
  const take = limit;
  const skip = (page - 1) * take;

  const [sentJobs, total] = await this.sentJobRepo.findAndCount({
    where: { userId: id },
    order: { match: 'DESC' },
    take,
    skip,
  });

  return {
    sentJobs,
    total,
    page,
    limit,
    lastPage: Math.ceil(total / take),
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
