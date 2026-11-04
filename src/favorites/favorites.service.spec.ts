import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FavoritesService, MAX_FAVORITES_PER_USER } from './favorites.service';

function setup(opts: { saved?: number[]; aliveJobs?: number[] } = {}) {
  const saved = [...(opts.saved ?? [])];
  const alive = new Set(opts.aliveJobs ?? []);
  const inserted: { userId: number; jobId: number }[][] = [];

  const insertBuilder = (values: any) => ({
    orIgnore: () => ({
      execute: async () => {
        const rows = Array.isArray(values) ? values : [values];
        inserted.push(rows);
        rows.forEach((r) => saved.includes(r.jobId) || saved.push(r.jobId));
      },
    }),
  });

  const favoriteRepo: any = {
    find: jest.fn(async () => saved.map((jobId) => ({ jobId }))),
    exists: jest.fn(async ({ where }) => saved.includes(where.jobId)),
    count: jest.fn(async () => saved.length),
    delete: jest.fn(),
    createQueryBuilder: () => ({ insert: () => ({ values: insertBuilder }) }),
  };
  const jobRepo: any = {
    exists: jest.fn(async ({ where }) => alive.has(where.id)),
    find: jest.fn(async ({ where }) => where.id._value.filter((id: number) => alive.has(id)).map((id: number) => ({ id }))),
  };

  return { service: new FavoritesService(favoriteRepo, jobRepo), inserted, saved };
}

describe('FavoritesService', () => {
  describe('merge', () => {
    it('imports only jobs that still exist and are not saved yet', async () => {
      const { service, inserted } = setup({ saved: [1], aliveJobs: [1, 2, 3] });

      const ids = await service.merge(7, [1, 2, 2, 3, 99]);

      expect(inserted).toEqual([[{ userId: 7, jobId: 2 }, { userId: 7, jobId: 3 }]]);
      expect(ids.sort()).toEqual([1, 2, 3]);
    });

    it('stops at the per-user limit', async () => {
      const saved = Array.from({ length: MAX_FAVORITES_PER_USER - 1 }, (_, i) => i + 1000);
      const { service, inserted } = setup({ saved, aliveJobs: [1, 2, 3] });

      await service.merge(7, [1, 2, 3]);

      expect(inserted).toEqual([[{ userId: 7, jobId: 1 }]]);
    });

    it('does nothing when every id is already saved or deleted', async () => {
      const { service, inserted } = setup({ saved: [1], aliveJobs: [1] });

      await service.merge(7, [1, 50]);

      expect(inserted).toEqual([]);
    });
  });

  describe('add', () => {
    it('rejects a job that no longer exists', async () => {
      const { service } = setup();
      await expect(service.add(7, 5)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('is a no-op for an already saved job, even at the limit', async () => {
      const saved = Array.from({ length: MAX_FAVORITES_PER_USER }, (_, i) => i + 1);
      const { service, inserted } = setup({ saved, aliveJobs: [1] });

      await service.add(7, 1);

      expect(inserted).toEqual([]);
    });

    it('rejects a new job once the limit is reached', async () => {
      const saved = Array.from({ length: MAX_FAVORITES_PER_USER }, (_, i) => i + 1000);
      const { service } = setup({ saved, aliveJobs: [1] });

      await expect(service.add(7, 1)).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
