import { Test, TestingModule } from '@nestjs/testing';
import { AiMatchedJobsService } from './ai-matched-jobs.service';

describe('AiMatchedJobsService', () => {
  let service: AiMatchedJobsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AiMatchedJobsService],
    }).compile();

    service = module.get<AiMatchedJobsService>(AiMatchedJobsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
