import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JobService, buildWordBoundaryRegex } from './job.service';
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
      limit: jest.fn().mockReturnThis(),
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

  describe('buildWordBoundaryRegex & getSearchVariants', () => {
    it('should correctly strip Georgian suffixes and build word boundary regex', () => {
      const regexFinance = buildWordBoundaryRegex('ფინანსები');
      // Should include stem 'ფინანს'
      expect(regexFinance).toContain('ფინანს');
      expect(regexFinance).toContain('(^|[^a-zA-Z0-9\u10A0-\u10FF])');

      // Test matching in JS against realistic strings
      const jsRegex = new RegExp('(^|[^a-zA-Z0-9\u10A0-\u10FF])(ფინანსები|ფინანს)', 'i');
      expect(jsRegex.test('მთავარი ფინანსისტი')).toBe(true);
      expect(jsRegex.test('ფინანსური დირექტორი')).toBe(true);
      expect(jsRegex.test('Finance / ფინანსები')).toBe(true);

      // Crucial: should NOT match 'დაფინანსება' or 'სრული დაფინანსებით'
      expect(jsRegex.test('სრული დაფინანსებით')).toBe(false);
      expect(jsRegex.test('დაფინანსება')).toBe(false);
      expect(jsRegex.test('თანადაფინანსება')).toBe(false);
    });

    it('should correctly handle English suffixes', () => {
      const regexDeveloper = buildWordBoundaryRegex('developer');
      expect(regexDeveloper).toContain('develop');

      const jsRegex = new RegExp('(^|[^a-zA-Z0-9\u10A0-\u10FF])(developer|develop)', 'i');
      expect(jsRegex.test('Senior Developer')).toBe(true);
      expect(jsRegex.test('Web Development')).toBe(true);
      expect(jsRegex.test('Undeveloped')).toBe(false);
    });
  });

  describe('findAll', () => {
    it('should build query with correct hierarchical priority: Title (1,000,000) > Company (10,000) > Description (100)', async () => {
      await service.findAll({
        query: 'ანგულარ დეველოპერი',
        page: 1,
        limit: 10,
      });

      // Verify that queryBuilder was created
      expect(jobRepoMock.createQueryBuilder).toHaveBeenCalledWith('job');

      // Verify parameters
      expect(queryBuilderMock.setParameter).toHaveBeenCalledWith('phraseRegex', expect.any(String));
      expect(queryBuilderMock.setParameter).toHaveBeenCalledWith('wholePhraseLike', '%ანგულარ დეველოპერი%');
      expect(queryBuilderMock.setParameter).toHaveBeenCalledWith('termRegex0', expect.any(String));
      expect(queryBuilderMock.setParameter).toHaveBeenCalledWith('termRegex1', expect.any(String));

      // Verify hierarchical ordering: 1000000 for title, 10000 for company, 100 for description
      const orderByCall = queryBuilderMock.orderBy.mock.calls[0][0];
      expect(orderByCall).toContain('1000000');
      expect(orderByCall).toContain('10000');
      expect(orderByCall).toContain('100');
      expect(queryBuilderMock.addOrderBy).toHaveBeenCalledWith('job.id', 'DESC');
    });

    it('should build query with correct ordering when searching with a single term', async () => {
      await service.findAll({
        query: 'ფინანსები',
        page: 1,
        limit: 10,
      });

      expect(queryBuilderMock.setParameter).toHaveBeenCalledWith('termRegex0', expect.any(String));

      const orderByCall = queryBuilderMock.orderBy.mock.calls[0][0];
      expect(orderByCall).toContain('WHEN (job.vacancy ~* :termRegex0) THEN 1000000');
      expect(orderByCall).toContain('WHEN (job.company ~* :termRegex0) THEN 10000');
      expect(queryBuilderMock.addOrderBy).toHaveBeenCalledWith('job.id', 'DESC');
    });
  });

  describe('findAllByQuery', () => {
    it('should return empty array when given empty query', async () => {
      const result = await service.findAllByQuery([]);
      expect(result).toEqual([]);
      expect(jobRepoMock.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('should build query and relevancy ordering when searching with array of terms and phrases', async () => {
      const mockJobs = [{ id: 1, vacancy: 'Angular Developer', company: 'Google', description: 'Web development' }];
      queryBuilderMock.getMany.mockResolvedValue(mockJobs);

      const result = await service.findAllByQuery(['Angular Developer', 'Frontend']);

      expect(jobRepoMock.createQueryBuilder).toHaveBeenCalledWith('job');
      expect(queryBuilderMock.setParameter).toHaveBeenCalledWith('wholePhrase0', expect.any(String));
      expect(queryBuilderMock.setParameter).toHaveBeenCalledWith('wholePhraseLike0', '%angular developer%');
      expect(queryBuilderMock.setParameter).toHaveBeenCalledWith('searchTerm0', expect.any(String));

      const orderByCall = queryBuilderMock.orderBy.mock.calls[0][0];
      expect(orderByCall).toContain('1000000');
      expect(orderByCall).toContain('10000');
      expect(orderByCall).toContain('100');
      expect(queryBuilderMock.addOrderBy).toHaveBeenCalledWith('job.id', 'DESC');
      expect(queryBuilderMock.limit).toHaveBeenCalledWith(60);
      expect(result).toEqual(mockJobs);
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
