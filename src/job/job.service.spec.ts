import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JobService, buildWordBoundaryRegex, buildPhraseRegex, buildSalaryRegex, parseSearchQuery, getCityNameVariants } from './job.service';
import { JobEntity } from 'src/Entities/job.entity';
import { ScrapedJobEntity } from 'src/Entities/scraped-job.entity';
import { JobsGeScraperService } from '../scrapers/jobs-ge.scraper';
import { HrGeScraperService } from '../scrapers/hr-ge-scraper.service';
import { AworkGeScraperService } from '../scrapers/awork-ge.scraper';
import { MyjobsGeScraperService } from '../scrapers/myjobs-ge.scraper';
import { LinkedinScraperService } from '../scrapers/linkedin.scraper';

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
      getCount: jest.fn().mockResolvedValue(0),
      getMany: jest.fn().mockResolvedValue([]),
      getRawMany: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orIgnore: jest.fn().mockReturnThis(),
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
          provide: getRepositoryToken(ScrapedJobEntity),
          useValue: {},
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
        {
          provide: LinkedinScraperService,
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

  describe('buildPhraseRegex', () => {
    const matches = (query: string, text: string) => new RegExp(buildPhraseRegex(query), 'i').test(text);

    it('should require multi-word queries to match together as a phrase', () => {
      expect(matches('financial analyst', 'Senior Financial Analyst')).toBe(true);
      expect(matches('financial analyst', 'Financial Analysts')).toBe(true);
      expect(matches('financial analyst', 'Financial / Analyst')).toBe(true);

      expect(matches('financial analyst', 'Data Analyst')).toBe(false);
      expect(matches('financial analyst', 'Financial Manager')).toBe(false);
      expect(matches('financial analyst', 'Analyst, financial department')).toBe(false);
      expect(matches('financial analyst', 'Financial reporting and analyst support')).toBe(false);
    });

    it('should keep stem variants and word boundaries for Georgian phrases', () => {
      expect(matches('ფინანსური ანალიტიკოსი', 'უფროსი ფინანსური ანალიტიკოსი')).toBe(true);
      expect(matches('ფინანსური ანალიტიკოსი', 'ანალიტიკოსი')).toBe(false);
      expect(matches('ფინანსები', 'დაფინანსება')).toBe(false);
    });
  });

  describe('parseSearchQuery', () => {
    it('should split text from salary amounts and drop currency words', () => {
      expect(parseSearchQuery('Financial Analyst')).toEqual({ text: 'financial analyst', amounts: [] });
      expect(parseSearchQuery('accountant 1500 ლარი')).toEqual({ text: 'accountant', amounts: ['1500'] });
      expect(parseSearchQuery('$2,000')).toEqual({ text: '', amounts: ['2000'] });
      expect(parseSearchQuery('1500-2000 gel')).toEqual({ text: '', amounts: ['1500', '2000'] });
    });
  });

  describe('buildSalaryRegex', () => {
    const matches = (amount: string, text: string) => new RegExp(buildSalaryRegex(amount), 'i').test(text);

    it('should match amounts written as salaries', () => {
      expect(matches('1500', 'ანაზღაურება: 1500 ლარი')).toBe(true);
      expect(matches('1500', 'ხელფასი: 1 500 - 2 000')).toBe(true);
      expect(matches('2000', 'ანაზღაურება: 1800-2000 ლარი')).toBe(true);
      expect(matches('2000', 'Salary: 2,000')).toBe(true);
      expect(matches('2000', 'up to 2000 GEL')).toBe(true);
      expect(matches('2000', 'from $2000')).toBe(true);
    });

    it('should not match numbers that are not salaries', () => {
      expect(matches('2000', 'კომპანია დაარსდა 2000 წელს')).toBe(false);
      expect(matches('2000', 'ანაზღაურება: 12000 ლარი')).toBe(false);
      expect(matches('500', 'ანაზღაურება: 1500 ლარი')).toBe(false);
      expect(matches('2000', 'ანაზღაურება: შეთანხმებით\n\nდაარსდა 2000 წელს')).toBe(false);
    });
  });

  describe('getCityNameVariants', () => {
    it('should map a city name to both spellings', () => {
      expect(getCityNameVariants('Batumi')).toEqual(['ბათუმი', 'batumi']);
      expect(getCityNameVariants('თბილისი')).toEqual(['თბილისი', 'tbilisi']);
      expect(getCityNameVariants('developer')).toEqual([]);
    });
  });

  describe('findAll', () => {
    it('should match the text phrase in title, company and location only, ranked Title > Company > Location', async () => {
      await service.findAll({
        query: 'ანგულარ დეველოპერი',
        page: 1,
        limit: 10,
      });

      expect(jobRepoMock.createQueryBuilder).toHaveBeenCalledWith('job');
      expect(queryBuilderMock.setParameter).toHaveBeenCalledWith('phraseRegex', buildPhraseRegex('ანგულარ დეველოპერი'));

      const whereSql = queryBuilderMock.andWhere.mock.calls.map((c: any[]) => c[0]).join(' ');
      expect(whereSql).toContain('job.vacancy ~* :phraseRegex');
      expect(whereSql).toContain('job.company ~* :phraseRegex');
      expect(whereSql).toContain('job.location ~* :phraseRegex');
      expect(whereSql).not.toContain('description');

      const orderByCall = queryBuilderMock.orderBy.mock.calls[0][0];
      expect(orderByCall).toContain('WHEN job.vacancy ~* :phraseRegex THEN 3');
      expect(orderByCall).toContain('WHEN job.company ~* :phraseRegex THEN 2');
      expect(orderByCall).toContain('ELSE 1');
      expect(queryBuilderMock.addOrderBy).toHaveBeenCalledWith('job.id', 'DESC');
    });

    it('should search the description only for salary amounts', async () => {
      await service.findAll({
        query: 'გაყიდვების მენეჯერი 1500',
        page: 1,
        limit: 10,
      });

      expect(queryBuilderMock.andWhere).toHaveBeenCalledWith('job.description ~* :salaryRegex0', {
        salaryRegex0: buildSalaryRegex('1500'),
      });
      expect(queryBuilderMock.setParameter).toHaveBeenCalledWith('phraseRegex', buildPhraseRegex('გაყიდვების მენეჯერი'));
    });

    it('should also match the other spelling of a city in location', async () => {
      await service.findAll({
        query: 'batumi',
        page: 1,
        limit: 10,
      });

      expect(queryBuilderMock.setParameter).toHaveBeenCalledWith('cityName0', '%ბათუმი%');
      expect(queryBuilderMock.setParameter).toHaveBeenCalledWith('cityName1', '%batumi%');
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

  describe('scrapeAndDeduplicateLinkedin', () => {
    it('should compare scraped LinkedIn jobs against database and return non-duplicated jobs and counts', async () => {
      // Mock LinkedIn scraper
      const mockLinkedinJobs = [
        {
          vacancy: 'Senior Software Engineer',
          company: 'TechCorp Georgia',
          location: 'Tbilisi',
          link: 'https://linkedin.com/jobs/view/111',
        },
        {
          vacancy: 'Product Manager',
          company: 'Innovate LLC',
          location: 'Tbilisi',
          link: 'https://linkedin.com/jobs/view/222',
        },
        {
          vacancy: 'Senior Software Engineer', // duplicate within batch
          company: 'TechCorp Georgia',
          location: 'Tbilisi',
          link: 'https://linkedin.com/jobs/view/333',
        },
      ];

      (service as any).linkedinScraperService = {
        scrapeAllGeorgiaJobs: jest.fn().mockResolvedValue({
          jobs: mockLinkedinJobs,
          totalJobs: mockLinkedinJobs.length,
          lastPage: 1,
        }),
      };

      // Mock DB containing Product Manager from Innovate LLC
      jobRepoMock.find = jest.fn().mockResolvedValue([
        {
          id: 10,
          vacancy: 'Product Manager',
          company: 'Innovate LLC',
          location: 'თბილისი',
          link: 'https://jobs.ge/10',
        },
      ]);

      const result = await service.scrapeAndDeduplicateLinkedin();

      expect(result.totalScraped).toBe(3);
      expect(result.comparedAgainstCount).toBe(1);
      expect(result.nonDuplicatedCount).toBe(1);
      expect(result.duplicatesCount).toBe(2);
      expect(result.nonDuplicatedJobs.length).toBe(1);
      expect(result.nonDuplicatedJobs[0].vacancy).toBe('Senior Software Engineer');
      expect(result.duplicates.length).toBe(2);
      expect(result.savedToDb).toBe(true);
      expect(result.insertedToDbCount).toBe(1);
    });
  });
});
