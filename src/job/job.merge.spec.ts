import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JobService } from './job.service';
import { JobEntity } from 'src/Entities/job.entity';
import { ScrapedJobEntity } from 'src/Entities/scraped-job.entity';
import { JobsGeScraperService } from '../scrapers/jobs-ge.scraper';
import { HrGeScraperService } from '../scrapers/hr-ge-scraper.service';
import { AworkGeScraperService } from '../scrapers/awork-ge.scraper';
import { MyjobsGeScraperService } from '../scrapers/myjobs-ge.scraper';
import { LinkedinScraperService } from '../scrapers/linkedin.scraper';
import { CompanyLogoService } from 'src/companies/company-logo.service';

describe('JobService.mergeStagedJobs', () => {
  let service: JobService;
  let jobRepo: { find: jest.Mock };
  let scrapedJobRepo: { find: jest.Mock; delete: jest.Mock };
  let insertMany: jest.SpyInstance;
  let logos: { register: jest.Mock };

  const row = (source: string, vacancy: string, company: string, location = 'თბილისი', description = '', companyLogo: string | null = null) => ({
    runId: 'run1',
    source,
    vacancy,
    company,
    location,
    link: `https://${source}.test/${vacancy}-${location}`.replace(/\s/g, ''),
    publishDate: '',
    deadline: '',
    page: 1,
    description,
    companyLogo,
  });

  const stage = (rows: ReturnType<typeof row>[]) =>
    scrapedJobRepo.find.mockImplementation(async ({ where }) => rows.filter((r) => r.source === where.source));

  beforeEach(async () => {
    jobRepo = { find: jest.fn().mockResolvedValue([]) };
    scrapedJobRepo = { find: jest.fn(), delete: jest.fn().mockResolvedValue(undefined) };
    logos = { register: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobService,
        { provide: getRepositoryToken(JobEntity), useValue: jobRepo },
        { provide: getRepositoryToken(ScrapedJobEntity), useValue: scrapedJobRepo },
        { provide: JobsGeScraperService, useValue: {} },
        { provide: HrGeScraperService, useValue: {} },
        { provide: AworkGeScraperService, useValue: {} },
        { provide: MyjobsGeScraperService, useValue: {} },
        { provide: LinkedinScraperService, useValue: {} },
        { provide: CompanyLogoService, useValue: logos },
      ],
    }).compile();

    service = module.get(JobService);
    insertMany = jest.spyOn(service, 'insertMany').mockResolvedValue(undefined);
  });

  it('keeps the higher-priority source when the same vacancy|company appears in several sources', async () => {
    stage([
      row('hrge', 'Sales Manager', 'Aldagi'),
      row('jobsge', 'sales  manager!', 'ALDAGI', 'თბილისი'),
      row('linkedin', 'Sales Manager', 'Aldagi', 'Tbilisi'),
    ]);

    const result = await service.mergeStagedJobs('run1');

    expect(result.totalInserted).toBe(1);
    expect(result.perSource.find((s) => s.source === 'jobsge')?.duplicatesRemoved).toBe(1);
    expect(result.perSource.find((s) => s.source === 'linkedin')?.duplicatesRemoved).toBe(1);
    const inserted = insertMany.mock.calls.flatMap((c) => c[0]);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].link).toContain('hrge');
  });

  it('keeps the same vacancy|company when it is in a different city', async () => {
    jobRepo.find.mockResolvedValue([{ vacancy: 'Cashier', company: 'Shop', location: 'თბილისი' }]);
    stage([
      row('hrge', 'Cashier', 'Shop', 'ბათუმი'),
      row('linkedin', 'Cashier', 'Shop', 'Batumi, Georgia'),
      row('linkedin', 'Cashier', 'Shop', 'Kutaisi, Georgia'),
    ]);

    const result = await service.mergeStagedJobs('run1');

    expect(result.perSource.find((s) => s.source === 'hrge')?.inserted).toBe(1);
    expect(result.perSource.find((s) => s.source === 'linkedin')?.duplicatesRemoved).toBe(1);
    expect(result.perSource.find((s) => s.source === 'linkedin')?.inserted).toBe(1);
  });

  it('treats an unrecognized location as a match for any city', async () => {
    stage([row('hrge', 'Designer', 'Studio', 'თბილისი'), row('linkedin', 'Designer', 'Studio', 'Georgia')]);

    const result = await service.mergeStagedJobs('run1');

    expect(result.totalInserted).toBe(1);
  });

  it('skips jobs that already exist in the database', async () => {
    jobRepo.find.mockResolvedValue([{ vacancy: 'Accountant', company: 'Bank', location: 'თბილისი' }]);
    stage([row('awork', 'Accountant', 'Bank'), row('awork', 'Driver', 'Bank')]);

    const result = await service.mergeStagedJobs('run1');

    expect(result.totalInserted).toBe(1);
    expect(insertMany.mock.calls[0][0][0].vacancy).toBe('Driver');
  });

  it('keeps multi-location postings from the same source', async () => {
    stage([
      row('hrge', 'Cashier', 'Shop', 'თბილისი'),
      row('hrge', 'Cashier', 'Shop', 'ბათუმი'),
    ]);

    const result = await service.mergeStagedJobs('run1');

    expect(result.totalInserted).toBe(2);
    expect(result.perSource[0].duplicatesRemoved).toBe(0);
  });

  it('collapses same-fingerprint rows in one source, preferring the longer description', async () => {
    stage([
      row('hrge', 'Nurse', 'Clinic', 'თბილისი', 'short'),
      row('hrge', 'Nurse', 'Clinic', 'თბილისი', 'a much longer description'),
    ]);

    await service.mergeStagedJobs('run1');

    const inserted = insertMany.mock.calls.flatMap((c) => c[0]);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].description).toBe('a much longer description');
  });

  it('reports every company and its logos to the logo service, duplicates included', async () => {
    stage([
      row('hrge', 'Sales Manager', 'Aldagi', 'თბილისი', '', 'https://cf/a.png'),
      row('awork', 'Sales Manager', 'ALDAGI', 'თბილისი', '', 'https://awork/a.jpg'),
      row('jobsge', 'Cashier', 'Shop'),
    ]);

    await service.mergeStagedJobs('run1');

    const [companies, candidates] = logos.register.mock.calls[0];
    expect(companies).toEqual(['Aldagi', 'Shop', 'ALDAGI']);
    // The awork row was a duplicate job, but its (better) logo still counts
    expect(candidates).toEqual([
      { company: 'Aldagi', source: 'hrge', url: 'https://cf/a.png' },
      { company: 'ALDAGI', source: 'awork', url: 'https://awork/a.jpg' },
    ]);
  });

  it('still merges when the logo step fails', async () => {
    logos.register.mockRejectedValue(new Error('redis down'));
    stage([row('hrge', 'Cashier', 'Shop')]);
    await expect(service.mergeStagedJobs('run1')).resolves.toMatchObject({ totalInserted: 1 });
  });

  it('cleans up staged rows for the run after merging', async () => {
    stage([row('hrge', 'Nurse', 'Clinic')]);

    await service.mergeStagedJobs('run1');

    expect(scrapedJobRepo.delete).toHaveBeenCalledWith({ runId: 'run1' });
  });
});
