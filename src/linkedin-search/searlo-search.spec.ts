import { LinkedinSearchService } from './linkedin-search.service';
import { GoogleBrowserService, GoogleResult } from './google-browser.service';
import { PublicCvLimitsService } from 'src/cv/public-cv-limits.service';
import { SearloError, SearloSearchService } from './searlo-search.service';

const profile = (n: number): GoogleResult => ({
  title: `Nino ${n} - Accountant - TBC | LinkedIn`,
  url: `https://ge.linkedin.com/in/nino-${n}?trk=x`,
  snippet: 'Open to work',
});

const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

describe('SearloSearchService', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    process.env.SEARLO_API_KEY = 'sk_test';
    fetchMock = jest.fn();
    global.fetch = fetchMock as any;
  });
  afterAll(() => {
    global.fetch = realFetch;
    delete process.env.SEARLO_API_KEY;
  });

  it('sends the key and query, maps organic results', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        organic: [
          { position: 1, title: 'Ani - Designer | LinkedIn', link: 'https://www.linkedin.com/in/ani', snippet: 'Tbilisi' },
          { position: 2, title: 'No link' },
          { position: 3, title: 'Gio | LinkedIn', link: 'https://www.linkedin.com/in/gio', description: 'Batumi' },
        ],
      }),
    );
    const results = await new SearloSearchService().search('site:linkedin.com/in "Designer"', 2);

    const [url, init] = fetchMock.mock.calls[0];
    const params = new URL(url).searchParams;
    expect(params.get('q')).toBe('site:linkedin.com/in "Designer"');
    expect(params.get('page')).toBe('2');
    expect(params.get('limit')).toBe('10');
    expect(init.headers['x-api-key']).toBe('sk_test');
    expect(results).toEqual([
      { title: 'Ani - Designer | LinkedIn', url: 'https://www.linkedin.com/in/ani', snippet: 'Tbilisi' },
      { title: 'Gio | LinkedIn', url: 'https://www.linkedin.com/in/gio', snippet: 'Batumi' },
    ]);
  });

  it('treats a page past the end as no results, other errors as failures', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { success: false, errorCode: 'PAGE_OUT_OF_RANGE', maxPage: 11 }));
    await expect(new SearloSearchService().search('q', 12)).resolves.toEqual([]);

    fetchMock.mockResolvedValueOnce(jsonResponse(402, { success: false, errorCode: 'INSUFFICIENT_CREDITS', message: 'No credits' }));
    await expect(new SearloSearchService().search('q')).rejects.toBeInstanceOf(SearloError);

    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(new SearloSearchService().search('q')).rejects.toThrow('ECONNRESET');
  });

  it('is off without a key', () => {
    delete process.env.SEARLO_API_KEY;
    expect(new SearloSearchService().enabled).toBe(false);
  });
});

describe('LinkedinSearchService provider fallback', () => {
  const setup = (searloEnabled = true) => {
    const searlo = { enabled: searloEnabled, search: jest.fn().mockResolvedValue([profile(1)]) };
    const browser = { search: jest.fn().mockResolvedValue([profile(2)]) };
    const cache = { getJson: jest.fn().mockResolvedValue(null), setJson: jest.fn() };
    const service = new LinkedinSearchService(
      browser as unknown as GoogleBrowserService,
      cache as unknown as PublicCvLimitsService,
      searlo as unknown as SearloSearchService,
    );
    return { service, searlo, browser, cache };
  };

  it('uses Searlo first and cleans up the profile', async () => {
    const { service, browser } = setup();
    const res = await service.search({ keyword: 'Accountant', location: 'Tbilisi' } as any);
    expect(res.provider).toBe('searlo');
    expect(browser.search).not.toHaveBeenCalled();
    expect(res.profiles[0]).toMatchObject({ name: 'Nino 1', headline: 'Accountant - TBC', url: 'https://www.linkedin.com/in/nino-1' });
  });

  it('falls back to the browser when Searlo fails, then skips Searlo for a while', async () => {
    const { service, searlo, browser } = setup();
    searlo.search.mockRejectedValue(new SearloError('402 INSUFFICIENT_CREDITS', 402));

    const first = await service.search({ keyword: 'Accountant' } as any);
    expect(first.provider).toBe('google-browser');
    expect(first.profiles[0].url).toBe('https://www.linkedin.com/in/nino-2');

    await service.search({ keyword: 'Developer' } as any);
    expect(searlo.search).toHaveBeenCalledTimes(1); // paused, straight to the browser
    expect(browser.search).toHaveBeenCalledTimes(2);
  });

  it('uses the browser when Searlo is not configured', async () => {
    const { service, searlo } = setup(false);
    expect((await service.search({ keyword: 'Accountant' } as any)).provider).toBe('google-browser');
    expect(searlo.search).not.toHaveBeenCalled();
  });

  it('answers repeated searches from the cache without any provider', async () => {
    const { service, searlo, browser, cache } = setup();
    cache.getJson.mockResolvedValue([{ name: 'Cached', headline: null, url: 'u', snippet: '' }]);
    const res = await service.search({ keyword: 'Accountant' } as any);
    expect(res.cached).toBe(true);
    expect(searlo.search).not.toHaveBeenCalled();
    expect(browser.search).not.toHaveBeenCalled();
  });
});
