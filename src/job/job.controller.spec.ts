import { Test, TestingModule } from '@nestjs/testing';
import { JobController } from './job.controller';
import { JobService } from './job.service';
import { FilterJobDto } from './dto/filter-job.dto';
import { ScrapeQueueService } from './scrape-queue.service';
import { ThrottlerModule } from '@nestjs/throttler';

// @nestjs/bullmq ships ESM that jest cannot load; the queue service is mocked below
jest.mock('./scrape-queue.service', () => ({ ScrapeQueueService: class ScrapeQueueService {} }));

describe('JobController', () => {
  let controller: JobController;
  let jobService: JobService;

  const mockJobService = {
    findAll: jest.fn().mockResolvedValue({
      jobs: [],
      counts: { totalRecords: 300, filteredRecords: 300 },
      page: 1,
      limit: 10,
    }),
    create: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    scrapper: jest.fn(),
    findAllByQuery: jest.fn(),
    findDuplicates: jest.fn(),
    findOutdated: jest.fn(),
    removeOutdated: jest.fn(),
    hardRemove: jest.fn(),
    getJobsCountByLocation: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 60 }])],
      controllers: [JobController],
      providers: [
        {
          provide: JobService,
          useValue: mockJobService,
        },
        {
          provide: ScrapeQueueService,
          useValue: {
            enqueueDailyScrape: jest.fn(),
            enqueueEnrichment: jest.fn(),
            getFlowStatus: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<JobController>(JobController);
    jobService = module.get<JobService>(JobService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAll', () => {
    it('passes the search straight to the service, which applies the search limits', async () => {
      const filterDto: FilterJobDto = { query: 'მოლარე', page: 10, limit: 10 };
      const result = await controller.findAll(filterDto);
      expect(mockJobService.findAll).toHaveBeenCalledWith(filterDto);
      expect(result).toBeDefined();
    });
  });
});
