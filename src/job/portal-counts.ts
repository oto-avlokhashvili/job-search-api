import { Like, Repository } from 'typeorm';
import { JobEntity } from 'src/Entities/job.entity';

export interface PortalCounts {
  jobsGe: number;
  hrGe: number;
  aworkGe: number;
  myjobsGe: number;
  linkedin: number;
}

/**
 * Number of jobs per source portal, across the whole table (ignores any filters).
 * Shared by /job/all and /stats so both report the same numbers.
 */
export async function countJobsByPortal(jobRepo: Repository<JobEntity>): Promise<PortalCounts> {
  const [jobsGe, hrGe, aworkGe, myjobsGe, linkedin] = await Promise.all([
    jobRepo
      .createQueryBuilder('job')
      .where('job.link LIKE :jobsGe', { jobsGe: '%jobs.ge%' })
      .andWhere('job.link NOT LIKE :myjobs', { myjobs: '%myjobs%' })
      .getCount(),

    jobRepo.count({
      where: [
        { link: Like('%hr.ge%') },
        { link: Like('%cv.ge%') },
        { link: Like('%doctor.ge%') },
        { link: Like('%chefs.ge%') },
      ],
    }),

    jobRepo.count({ where: { link: Like('%awork%') } }),

    jobRepo.count({ where: { link: Like('%myjobs%') } }),

    jobRepo.count({ where: { link: Like('%linkedin%') } }),
  ]);

  return { jobsGe, hrGe, aworkGe, myjobsGe, linkedin };
}
