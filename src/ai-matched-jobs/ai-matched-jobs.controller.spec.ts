import { Test, TestingModule } from '@nestjs/testing';
import { autoMock } from '../../test/auto-mock';
import { AiMatchedJobsController } from './ai-matched-jobs.controller';
import { AiMatchedJobsService } from './ai-matched-jobs.service';

describe('AiMatchedJobsController', () => {
  let controller: AiMatchedJobsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AiMatchedJobsController],
      providers: [AiMatchedJobsService],
    }).useMocker(autoMock).compile();

    controller = module.get<AiMatchedJobsController>(AiMatchedJobsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
