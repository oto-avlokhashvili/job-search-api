import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { StatsService } from './stats.service';
import { StatsController } from './stats.controller';
import { User } from 'src/Entities/user.entity';
import { Subscription } from 'src/Entities/subscription.entity';
import { JobEntity } from 'src/Entities/job.entity';
import { Cv } from 'src/Entities/cv.entity';

describe('StatsService & StatsController', () => {
  let statsService: StatsService;
  let statsController: StatsController;

  const mockQueryBuilder = {
    leftJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getCount: jest.fn().mockResolvedValue(14204),
  };

  const mockUserRepo = {
    createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    count: jest.fn().mockResolvedValue(8942),
  };

  const mockSubscriptionRepo = {
    count: jest.fn().mockResolvedValue(14204),
  };

  const mockJobQueryBuilder = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getCount: jest.fn().mockResolvedValue(3120),
  };

  const mockJobRepo = {
    count: jest.fn().mockResolvedValue(8551),
    createQueryBuilder: jest.fn().mockReturnValue(mockJobQueryBuilder),
  };

  const mockCvRepo = {
    count: jest.fn().mockResolvedValue(94),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StatsController],
      providers: [
        StatsService,
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
        { provide: getRepositoryToken(Subscription), useValue: mockSubscriptionRepo },
        { provide: getRepositoryToken(JobEntity), useValue: mockJobRepo },
        { provide: getRepositoryToken(Cv), useValue: mockCvRepo },
      ],
    }).compile();

    statsService = module.get<StatsService>(StatsService);
    statsController = module.get<StatsController>(StatsController);
  });

  it('should be defined', () => {
    expect(statsService).toBeDefined();
    expect(statsController).toBeDefined();
  });

  it('should return operations stats matching required structure', async () => {
    const result = await statsController.getStats();

    expect(result).toEqual(
      expect.objectContaining({
        activeAgents: 14204,
        activeUsers: 8942,
        activeAggregators: 5,
        activeVacancies: 8551,
        uploadedCvs: 94,
        systemStatus: 'ოპტიმალური',
        syncedPortals: 5,
      }),
    );
    expect(result.aggregators).toHaveLength(5);
    expect(result.portalCounts).toEqual({
      jobsGe: 3120,
      hrGe: 8551,
      aworkGe: 8551,
      myjobsGe: 8551,
      linkedin: 8551,
    });
    expect(result.avgCalculationTimeSeconds).toBeGreaterThan(0);
  });
});
