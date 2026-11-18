import { SearchService } from './search.service';

describe('SearchService', () => {
  const page = (jobs: any[]) => ({ jobs, counts: { filteredRecords: jobs.length, totalRecords: 100 }, page: 1, limit: 10 });
  let jobService: { findAll: jest.Mock };
  let aiService: { generateJson: jest.Mock };
  let jobRepo: { findOne: jest.Mock };
  let clickRepo: { insert: jest.Mock };
  let queryRepo: { query: jest.Mock };
  let service: SearchService;

  beforeEach(() => {
    jobService = { findAll: jest.fn().mockResolvedValue(page([{ id: 1 }])) };
    aiService = { generateJson: jest.fn().mockResolvedValue({ keywords: 'ბუღალტერი', city: 'ბათუმი', category: 'finance' }) };
    jobRepo = { findOne: jest.fn() };
    clickRepo = { insert: jest.fn().mockResolvedValue(undefined) };
    queryRepo = { query: jest.fn().mockResolvedValue(undefined) };
    service = new SearchService(jobService as any, aiService as any, jobRepo as any, clickRepo as any, queryRepo as any);
  });

  it('turns a sentence into keywords, city and category', async () => {
    const result = await service.search({ query: 'მინდა ბუღალტრად ვიმუშაო ბათუმში', page: 1, limit: 10 });
    expect(jobService.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'ბუღალტერი', location: 'ბათუმი', category: 'finance' }),
    );
    expect(result.interpreted).toEqual({ keywords: 'ბუღალტერი', city: 'ბათუმი', category: 'finance' });
  });

  it("keeps the visitor's own filters over the AI's reading", async () => {
    await service.search({ query: 'მინდა ბუღალტრად ვიმუშაო ბათუმში', location: 'თბილისი', page: 1, limit: 10 });
    expect(jobService.findAll).toHaveBeenCalledWith(expect.objectContaining({ location: 'თბილისი' }));
  });

  it('asks the AI once per sentence', async () => {
    await service.search({ query: 'მინდა ბუღალტრად ვიმუშაო ბათუმში' });
    await service.search({ query: 'მინდა  ბუღალტრად ვიმუშაო ბათუმში ' });
    expect(aiService.generateJson).toHaveBeenCalledTimes(1);
  });

  it('sends short searches straight to the keyword search', async () => {
    await service.search({ query: 'მოლარე', page: 1, limit: 10 });
    expect(aiService.generateJson).not.toHaveBeenCalled();
    expect(jobService.findAll).toHaveBeenCalledWith(expect.objectContaining({ query: 'მოლარე' }));
  });

  it('falls back to city and category when the title finds nothing', async () => {
    jobService.findAll.mockResolvedValueOnce(page([])).mockResolvedValueOnce(page([{ id: 2 }]));
    const result = await service.search({ query: 'მინდა ბუღალტრად ვიმუშაო ბათუმში' });
    expect(jobService.findAll).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: undefined, location: 'ბათუმი', category: 'finance' }),
    );
    expect(result.jobs).toEqual([{ id: 2 }]);
  });

  it('searches the raw text when the AI is unavailable', async () => {
    aiService.generateJson.mockResolvedValue(null);
    await service.search({ query: 'მინდა ბუღალტრად ვიმუშაო ბათუმში' });
    expect(jobService.findAll).toHaveBeenCalledWith(expect.objectContaining({ query: 'მინდა ბუღალტრად ვიმუშაო ბათუმში' }));
  });

  it('records first-page searches only', async () => {
    await service.search({ query: 'მოლარე', page: 1 });
    await service.search({ query: 'მოლარე', page: 2 });
    expect(queryRepo.query).toHaveBeenCalledTimes(1);
    expect(queryRepo.query.mock.calls[0][1]).toEqual(['მოლარე', 1]);
  });

  describe('clickOut', () => {
    it('counts the click and returns the original posting', async () => {
      jobRepo.findOne.mockResolvedValue({ id: 5, link: 'https://www.hr.ge/announcement/1' });
      expect(await service.clickOut(5)).toBe('https://www.hr.ge/announcement/1');
      expect(clickRepo.insert).toHaveBeenCalledWith({ jobId: 5, host: 'hr.ge' });
    });

    it('refuses anything that is not a web link', async () => {
      jobRepo.findOne.mockResolvedValue({ id: 6, link: 'javascript:alert(1)' });
      expect(await service.clickOut(6)).toBeNull();
      jobRepo.findOne.mockResolvedValue(null);
      expect(await service.clickOut(7)).toBeNull();
      expect(clickRepo.insert).not.toHaveBeenCalled();
    });
  });
});
