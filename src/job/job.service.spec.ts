import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JobService } from './job.service';
import { JobEntity } from 'src/Entities/job.entity';
import { JobsGeScraperService } from '../scrapers/jobs-ge.scraper';
import { HrGeScraperService } from '../scrapers/hr-ge-scraper.service';
import { AworkGeScraperService } from '../scrapers/awork-ge.scraper';
import { MyjobsGeScraperService } from '../scrapers/myjobs-ge.scraper';

describe('JobService', () => {
  let service: JobService;
  let queryBuilderMock: any;
  let jobRepoMock: any;

  beforeEach(async () => {
    queryBuilderMock = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      setParameter: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      getMany: jest.fn().mockResolvedValue([]),
      getRawMany: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 0 }),
    };

    jobRepoMock = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilderMock),
      count: jest.fn().mockResolvedValue(0),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobService,
        {
          provide: getRepositoryToken(JobEntity),
          useValue: jobRepoMock,
        },
        {
          provide: JobsGeScraperService,
          useValue: {},
        },
        {
          provide: HrGeScraperService,
          useValue: {},
        },
        {
          provide: AworkGeScraperService,
          useValue: {},
        },
        {
          provide: MyjobsGeScraperService,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<JobService>(JobService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should build query with correct relevancy ordering when searching with multiple terms', async () => {
      await service.findAll({
        query: 'ანგულარ დეველოპერი',
        page: 1,
        limit: 10,
      });

      // Verify that queryBuilder was created
      expect(jobRepoMock.createQueryBuilder).toHaveBeenCalledWith('job');

      // Verify that parameter for whole phrase was set
      expect(queryBuilderMock.setParameter).toHaveBeenCalledWith('wholePhrase', '%ანგულარ დეველოპერი%');

      // Verify ordering
      expect(queryBuilderMock.orderBy).toHaveBeenCalledWith(
        '(CASE WHEN LOWER(job.vacancy) LIKE :wholePhrase THEN 50 ELSE 0 END + ' +
        'CASE WHEN LOWER(job.company) LIKE :wholePhrase THEN 50 ELSE 0 END + ' +
        'CASE WHEN LOWER(job.description) LIKE :wholePhrase THEN 10 ELSE 0 END + ' +
        '(CASE WHEN LOWER(job.vacancy) LIKE :searchTerm0 THEN 10 ELSE 0 END +\n            ' +
        'CASE WHEN LOWER(job.company) LIKE :searchTerm0 THEN 10 ELSE 0 END +\n            ' +
        'CASE WHEN LOWER(job.description) LIKE :searchTerm0 THEN 1 ELSE 0 END) + ' +
        '(CASE WHEN LOWER(job.vacancy) LIKE :searchTerm1 THEN 10 ELSE 0 END +\n            ' +
        'CASE WHEN LOWER(job.company) LIKE :searchTerm1 THEN 10 ELSE 0 END +\n            ' +
        'CASE WHEN LOWER(job.description) LIKE :searchTerm1 THEN 1 ELSE 0 END))',
        'DESC'
      );
      expect(queryBuilderMock.addOrderBy).toHaveBeenCalledWith('job.id', 'DESC');
    });

    it('should build query with correct ordering when searching with a single term', async () => {
      await service.findAll({
        query: 'ანგულარ',
        page: 1,
        limit: 10,
      });

      // Since N=1, terms.length <= 1, so wholePhrase weight ordering won't be included.
      expect(queryBuilderMock.orderBy).toHaveBeenCalledWith(
        '((CASE WHEN LOWER(job.vacancy) LIKE :searchTerm0 THEN 10 ELSE 0 END +\n            ' +
        'CASE WHEN LOWER(job.company) LIKE :searchTerm0 THEN 10 ELSE 0 END +\n            ' +
        'CASE WHEN LOWER(job.description) LIKE :searchTerm0 THEN 1 ELSE 0 END))',
        'DESC'
      );
      expect(queryBuilderMock.addOrderBy).toHaveBeenCalledWith('job.id', 'DESC');
    });
  });

  describe('findOutdated', () => {
    it('should query for outdated jobs', async () => {
      const mockJobs = [{ id: 1, vacancy: 'Outdated Vacancy' }];
      queryBuilderMock.getMany.mockResolvedValue(mockJobs);

      const result = await service.findOutdated();

      expect(jobRepoMock.createQueryBuilder).toHaveBeenCalledWith('job');
      expect(queryBuilderMock.where).toHaveBeenCalledWith(expect.any(String));
      expect(result).toEqual(mockJobs);
    });
  });

  describe('removeOutdated', () => {
    it('should run delete query and return deletedCount', async () => {
      queryBuilderMock.execute.mockResolvedValue({ affected: 5 });

      const result = await service.removeOutdated();

      expect(jobRepoMock.createQueryBuilder).toHaveBeenCalled();
      expect(queryBuilderMock.delete).toHaveBeenCalled();
      expect(queryBuilderMock.from).toHaveBeenCalledWith(JobEntity);
      expect(queryBuilderMock.where).toHaveBeenCalledWith(expect.any(String));
      expect(queryBuilderMock.execute).toHaveBeenCalled();
      expect(result).toEqual({ deletedCount: 5 });
    });
  });

  describe('getJobsCountByLocation', () => {
    it('should query job repo for location and correctly map and group them in SQL', async () => {
      const mockRawStats = [
        { location: 'თბილისი', count: '2' },
        { location: 'ბათუმი', count: '2' },
        { location: 'ქუთაისი', count: '1' },
      ];
      queryBuilderMock.getRawMany.mockResolvedValue(mockRawStats);

      const result = await service.getJobsCountByLocation();

      expect(jobRepoMock.createQueryBuilder).toHaveBeenCalledWith('job');
      expect(queryBuilderMock.select).toHaveBeenCalledWith(expect.any(String), 'location');
      expect(queryBuilderMock.addSelect).toHaveBeenCalledWith('COUNT(job.id)', 'count');
      expect(queryBuilderMock.where).toHaveBeenCalledWith(expect.any(String));
      expect(queryBuilderMock.groupBy).toHaveBeenCalledWith(expect.any(String));
      expect(queryBuilderMock.orderBy).toHaveBeenCalledWith('count', 'DESC');
      expect(result).toEqual([
        { location: 'თბილისი', count: 2 },
        { location: 'ბათუმი', count: 2 },
        { location: 'ქუთაისი', count: 1 },
      ]);
    });

    it('should apply search parameter in memory from the cached values', async () => {
      const mockRawStats = [
        { location: 'თბილისი', count: '2' },
        { location: 'ბათუმი', count: '1' },
      ];
      queryBuilderMock.getRawMany.mockResolvedValue(mockRawStats);

      const result = await service.getJobsCountByLocation('ბათუმი');

      expect(result).toEqual([
        { location: 'ბათუმი', count: 1 },
      ]);
    });
  });
});
