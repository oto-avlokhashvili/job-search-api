import { Test, TestingModule } from '@nestjs/testing';
import { LinkedinScraperService } from './linkedin.scraper';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('LinkedinScraperService', () => {
  let service: LinkedinScraperService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [LinkedinScraperService],
    }).compile();

    service = module.get<LinkedinScraperService>(LinkedinScraperService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should scrape and parse job cards from LinkedIn guest HTML', async () => {
    const mockHtml = `
      <ul>
        <li>
          <div class="base-card" data-entity-urn="urn:li:jobPosting:123456789">
            <h3 class="base-search-card__title">Senior Software Engineer</h3>
            <h4 class="base-search-card__subtitle">TechCorp Georgia</h4>
            <span class="job-search-card__location">Tbilisi, Georgia</span>
            <a class="base-card__full-link" href="https://ge.linkedin.com/jobs/view/senior-software-engineer-123456789?refId=xyz"></a>
            <time datetime="2026-03-25">1 week ago</time>
          </div>
        </li>
      </ul>
    `;

    mockedAxios.get.mockResolvedValueOnce({
      data: mockHtml,
      status: 200,
    });

    const result = await service.scrapeJobs({
      maxPages: 1,
      fetchDescriptions: false,
    });

    expect(result.jobs.length).toBe(1);
    expect(result.jobs[0].vacancy).toBe('Senior Software Engineer');
    expect(result.jobs[0].company).toBe('TechCorp Georgia');
    expect(result.jobs[0].location).toBe('Tbilisi, Georgia');
    expect(result.jobs[0].link).toBe('https://ge.linkedin.com/jobs/view/senior-software-engineer-123456789');
    expect(result.jobs[0].publishDate).toBe('25/03/2026');
    expect(result.totalJobs).toBe(1);
  });

  const card = (id: number) => `
    <li>
      <div class="base-card" data-entity-urn="urn:li:jobPosting:${id}">
        <h3 class="base-search-card__title">Job ${id}</h3>
        <h4 class="base-search-card__subtitle">Company ${id}</h4>
        <span class="job-search-card__location">Tbilisi, Georgia</span>
        <a class="base-card__full-link" href="https://ge.linkedin.com/jobs/view/job-${id}"></a>
        <time datetime="2026-10-30">3 days ago</time>
      </div>
    </li>`;
  const page = (ids: number[]) => ({ data: `<ul>${ids.map(card).join('')}</ul>`, status: 200 });
  const requestedParams = (call: number) => new URL(mockedAxios.get.mock.calls[call][0]).searchParams;

  it('scopes searches to Georgia by geo id, never by the ambiguous "Georgia" location', async () => {
    mockedAxios.get.mockResolvedValue(page([1]));

    await service.scrapeJobs({ maxPages: 1 });
    await service.scrapeJobs({ maxPages: 1, location: 'Georgia' });
    await service.scrapeJobs({ maxPages: 1, location: 'Batumi' });

    expect(requestedParams(0).get('geoId')).toBe('106315325');
    expect(requestedParams(0).has('location')).toBe(false);
    expect(requestedParams(1).get('geoId')).toBe('106315325');
    expect(requestedParams(1).has('location')).toBe(false);
    expect(requestedParams(2).get('location')).toBe('Batumi');
    expect(requestedParams(2).has('geoId')).toBe(false);
  });

  it('scrapes the whole country newest first within the posting window, until a short page', async () => {
    jest.spyOn(service as any, 'applyHumanDelay').mockResolvedValue(undefined);
    const firstPage = Array.from({ length: 10 }, (_, i) => i + 1);
    mockedAxios.get.mockResolvedValueOnce(page(firstPage)).mockResolvedValueOnce(page([11, 12, 1]));

    const result = await service.scrapeAllGeorgiaJobs({ postedWithinDays: 2 });

    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    const params = requestedParams(1);
    expect(params.get('geoId')).toBe('106315325');
    expect(params.get('f_TPR')).toBe('r172800');
    expect(params.get('sortBy')).toBe('DD');
    expect(params.get('start')).toBe('10');
    expect(result.jobs.map((j) => j.vacancy)).toEqual([...firstPage, 11, 12].map((id) => `Job ${id}`));
    expect(result.jobs[10].page).toBe(2);
  });

  it('drops US-state "Georgia" postings, strips requisition ids, and still pages on the full card count', async () => {
    jest.spyOn(service as any, 'applyHumanDelay').mockResolvedValue(undefined);
    const li = (id: number, title: string, company: string, location: string) => `
      <li><div class="base-card" data-entity-urn="urn:li:jobPosting:${id}">
        <h3 class="base-search-card__title">${title}</h3>
        <h4 class="base-search-card__subtitle">${company}</h4>
        <span class="job-search-card__location">${location}</span>
        <a class="base-card__full-link" href="https://ge.linkedin.com/jobs/view/job-${id}"></a>
      </div></li>`;
    const us = Array.from({ length: 8 }, (_, i) => li(100 + i, `HVAC Instructor (6589${i})`, 'UEI College', 'Georgia'));
    mockedAxios.get
      .mockResolvedValueOnce({
        data: `<ul>${[...us, li(1, 'Startup Manager (12345)', 'NextVision', 'Tbilisi, Georgia'), li(2, 'Architect', 'Orbi Group', 'Batumi, Georgia')].join('')}</ul>`,
        status: 200,
      })
      .mockResolvedValueOnce({ data: '<ul></ul>', status: 200 });

    const result = await service.scrapeAllGeorgiaJobs();

    expect(result.jobs.map((j) => j.vacancy)).toEqual(['Startup Manager', 'Architect']);
    // 10 cards on page 1 (8 skipped) is still a full page, so page 2 was requested
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
  });

  it('should parse job description and criteria', async () => {
    const mockDetailHtml = `
      <div>
        <h2 class="top-card-layout__title">Senior Software Engineer</h2>
        <ul class="description__job-criteria-list">
          <li class="description__job-criteria-item">
            <h3 class="description__job-criteria-subheader">Employment type</h3>
            <span class="description__job-criteria-text">Full-time</span>
          </li>
        </ul>
        <div class="show-more-less-html__markup">
          <p>We are hiring a Node.js developer in Tbilisi.</p>
        </div>
      </div>
    `;

    mockedAxios.get.mockResolvedValueOnce({
      data: mockDetailHtml,
      status: 200,
    });

    const description = await service.fetchJobDescription('123456789');

    expect(description).toContain('Employment type: Full-time');
    expect(description).toContain('We are hiring a Node.js developer in Tbilisi.');
  });
});
