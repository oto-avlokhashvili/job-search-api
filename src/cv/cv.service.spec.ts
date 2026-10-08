import { Test, TestingModule } from '@nestjs/testing';
import { autoMock } from '../../test/auto-mock';
import { CvService } from './cv.service';

describe('CvService', () => {
  let service: CvService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CvService],
    }).useMocker(autoMock).compile();

    service = module.get<CvService>(CvService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
