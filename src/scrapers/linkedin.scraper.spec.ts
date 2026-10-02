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
