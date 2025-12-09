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

  async findByUserId(id:number) {
    const sentJobs = await this.sentJobRepo.find({where: {userId:id}})
    return sentJobs
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
