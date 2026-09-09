import { Test, TestingModule } from '@nestjs/testing';
import { JobController } from './job.controller';
import { JobService } from './job.service';
import { ForbiddenException } from '@nestjs/common';
import { FilterJobDto } from './dto/filter-job.dto';

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
    scrapeAndSaveAll: jest.fn(),
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
      controllers: [JobController],
      providers: [
        {
          provide: JobService,
          useValue: mockJobService,
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

  describe('findAll page boundary (allow up to page 5, throw 403 Forbidden beyond page 5 for unauthenticated users)', () => {
    it('should allow unauthenticated request for page 1', async () => {
      const filterDto: FilterJobDto = { page: 1, limit: 10 };
      const req = {};

      const result = await controller.findAll(filterDto, req);
      expect(mockJobService.findAll).toHaveBeenCalledWith(filterDto);
      expect(result).toBeDefined();
    });

    it('should allow unauthenticated request for page 5', async () => {
      const filterDto: FilterJobDto = { page: 5, limit: 10 };
      const req = {};

      const result = await controller.findAll(filterDto, req);
      expect(mockJobService.findAll).toHaveBeenCalledWith(filterDto);
      expect(result).toBeDefined();
    });

    it('should throw 403 ForbiddenException when unauthenticated and requesting page 6', async () => {
      const filterDto: FilterJobDto = { page: 6, limit: 10 };
      const req = {};

      await expect(controller.findAll(filterDto, req)).rejects.toThrow(ForbiddenException);
      expect(mockJobService.findAll).not.toHaveBeenCalled();
    });

    it('should throw 403 ForbiddenException when unauthenticated and requesting page > 6 (e.g., page 10)', async () => {
      const filterDto: FilterJobDto = { page: 10, limit: 10 };
      const req = {};

      await expect(controller.findAll(filterDto, req)).rejects.toThrow(ForbiddenException);
      expect(mockJobService.findAll).not.toHaveBeenCalled();
    });

    it('should allow authenticated request for page 6 and beyond', async () => {
      const filterDto: FilterJobDto = { page: 6, limit: 10 };
      const req = { user: { id: 1, email: 'test@example.com' } };

      const result = await controller.findAll(filterDto, req);
      expect(mockJobService.findAll).toHaveBeenCalledWith(filterDto);
      expect(result).toBeDefined();
    });

    it('should allow authenticated request for page 20', async () => {
      const filterDto: FilterJobDto = { page: 20, limit: 10 };
      const req = { user: { id: 1, email: 'test@example.com' } };

      const result = await controller.findAll(filterDto, req);
      expect(mockJobService.findAll).toHaveBeenCalledWith(filterDto);
      expect(result).toBeDefined();
    });
  });
});
