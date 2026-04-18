import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateAiMatchedJobDto } from './dto/create-ai-matched-job.dto';
import { UpdateAiMatchedJobDto } from './dto/update-ai-matched-job.dto';
import { AiMatchedJob } from 'src/Entities/ai-matched-job.entity';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AiMatchedJobsService {
  constructor(
    @InjectRepository(AiMatchedJob)
    private readonly topJobRepository: Repository<AiMatchedJob>,
    private readonly configService: ConfigService
  ) {}

  async create(
    userId: number,
    createAiMatchedJobDto: CreateAiMatchedJobDto,
  ): Promise<{ id: number; created: boolean }> {
    const existing = await this.topJobRepository.findOne({
      where: { link: createAiMatchedJobDto.link, userId },
    });

    if (existing) return { id: existing.id, created: false };

    const job = this.topJobRepository.create({ ...createAiMatchedJobDto, userId });
    const saved = await this.topJobRepository.save(job);
    return { id: saved.id, created: true };
  }

async createBulk(
  userId: number,
  createAiMatchedJobDtos: CreateAiMatchedJobDto[],
): Promise<{ inserted: number; skipped: number; ids: number[] }> {

  if (!createAiMatchedJobDtos.length) {
    return { inserted: 0, skipped: 0, ids: [] };
  }

  const links = createAiMatchedJobDtos.map((dto) => dto.link);

  const existingJobs = await this.topJobRepository
    .createQueryBuilder('job')
    .select('job.link', 'link')
    .where('job.link IN (:...links)', { links })
    .andWhere('job.userId = :userId', { userId })
    .getRawMany();

  const existingLinks = new Set(existingJobs.map((j) => j.link));
  const newDtos = createAiMatchedJobDtos.filter((dto) => !existingLinks.has(dto.link));

  if (newDtos.length === 0) {
    return { inserted: 0, skipped: createAiMatchedJobDtos.length, ids: [] };
  }

  const entities = this.topJobRepository.create(
    newDtos.map((dto) => ({ ...dto, userId })),
  );
  const saved = await this.topJobRepository.save(entities);

  return {
    inserted: saved.length,
    skipped: createAiMatchedJobDtos.length - saved.length,
    ids: saved.map((j) => j.id),
  };
}

  async findAll(
    userId: number,
    page: number = 1,
    limit: number = 20,
  ): Promise<{ data: AiMatchedJob[]; total: number; page: number; lastPage: number }> {
    const [data, total] = await this.topJobRepository.findAndCount({
      where: { userId },
      skip: (page - 1) * limit,
      take: limit,
      order: { match: 'DESC' },
    });

    return { data, total, page, lastPage: Math.ceil(total / limit) };
  }

  async findAllMatched(userId: number): Promise<AiMatchedJob[]> {
    return this.topJobRepository.find({
      where: { userId },
      order: { match: 'DESC' },
    });
  }

  async findOne(userId: number, id: number): Promise<AiMatchedJob> {
    const job = await this.topJobRepository.findOne({ where: { id, userId } });
    if (!job) throw new NotFoundException(`Job #${id} not found`);
    return job;
  }

  async update(
    userId: number,
    id: number,
    updateAiMatchedJobDto: UpdateAiMatchedJobDto,
  ): Promise<AiMatchedJob> {
    await this.findOne(userId, id);
    await this.topJobRepository.update({ id, userId }, updateAiMatchedJobDto);
    return this.findOne(userId, id);
  }

  async remove(userId: number, id: number): Promise<void> {
    await this.topJobRepository.delete({ id, userId });
  }
}