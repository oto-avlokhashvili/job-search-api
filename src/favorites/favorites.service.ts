import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { FavoriteJob } from 'src/Entities/favorite-job.entity';
import { JobEntity } from 'src/Entities/job.entity';

export const MAX_FAVORITES_PER_USER = 200;
export const MAX_FAVORITES_PER_REQUEST = 100;

@Injectable()
export class FavoritesService {
  constructor(
    @InjectRepository(FavoriteJob)
    private readonly favoriteRepo: Repository<FavoriteJob>,
    @InjectRepository(JobEntity)
    private readonly jobRepo: Repository<JobEntity>,
  ) {}

  /** Saved vacancies, newest first. Jobs deleted as outdated are already gone (cascade). */
  async findAll(userId: number): Promise<JobEntity[]> {
    const favorites = await this.favoriteRepo.find({
      where: { userId },
      relations: ['job'],
      order: { createdAt: 'DESC' },
    });
    return favorites.map((f) => f.job).filter(Boolean);
  }

  async findIds(userId: number): Promise<number[]> {
    const favorites = await this.favoriteRepo.find({ where: { userId }, select: ['jobId'] });
    return favorites.map((f) => f.jobId);
  }

  /** Idempotent: saving an already saved job is a no-op. */
  async add(userId: number, jobId: number): Promise<void> {
    if (!(await this.jobRepo.exists({ where: { id: jobId } }))) {
      throw new NotFoundException('ვაკანსია ვერ მოიძებნა');
    }
    if (await this.favoriteRepo.exists({ where: { userId, jobId } })) return;
    if ((await this.favoriteRepo.count({ where: { userId } })) >= MAX_FAVORITES_PER_USER) {
      throw new BadRequestException(`შეგიძლიათ შეინახოთ მაქსიმუმ ${MAX_FAVORITES_PER_USER} ვაკანსია`);
    }
    await this.favoriteRepo.createQueryBuilder().insert().values({ userId, jobId }).orIgnore().execute();
  }

  async remove(userId: number, jobId: number): Promise<void> {
    await this.favoriteRepo.delete({ userId, jobId });
  }

  /**
   * Imports favorites saved in the browser before signing in. Ids of deleted jobs are skipped,
   * and the per-user limit still applies. Returns the account's ids after the merge.
   */
  async merge(userId: number, jobIds: number[]): Promise<number[]> {
    const existing = new Set(await this.findIds(userId));
    const candidates = [...new Set(jobIds)].filter((id) => !existing.has(id));
    const room = MAX_FAVORITES_PER_USER - existing.size;

    if (candidates.length && room > 0) {
      const alive = await this.jobRepo.find({ where: { id: In(candidates) }, select: ['id'] });
      const toInsert = alive.slice(0, room).map((job) => ({ userId, jobId: job.id }));
      if (toInsert.length) {
        await this.favoriteRepo.createQueryBuilder().insert().values(toInsert).orIgnore().execute();
      }
    }
    return this.findIds(userId);
  }
}
