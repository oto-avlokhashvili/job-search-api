import sharp from 'sharp';
import { LogoStatus } from 'src/Entities/company.entity';
import { bestPerKey, findJobsGeLogo, isJobsGeCompanyPage, processLogo, shouldTake } from './company-logo';

const company = (over: Partial<Parameters<typeof shouldTake>[0] & object> = {}) => ({
  logoStatus: LogoStatus.OK,
  logoSourceUrl: 'https://a/logo.png',
  logoSource: 'myjobs',
  logoQuality: 4,
  logoCheckedAt: new Date('2026-10-01'),
  ...over,
});
const cand = (source: string, url = 'https://b/logo.png') => ({ company: 'X', source, url });
const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 4, background: { r: 30, g: 90, b: 200, alpha: 1 } } }).png().toBuffer();

describe('shouldTake', () => {
  const now = new Date('2026-10-29');

  it('takes a logo for a new company or one without', () => {
    expect(shouldTake(undefined, cand('hrge'), now)).toBe(true);
    expect(shouldTake(company({ logoStatus: LogoStatus.NONE, logoQuality: 0 }), cand('hrge'), now)).toBe(true);
  });

  it('upgrades to a better source, never downgrades', () => {
    expect(shouldTake(company({ logoSource: 'hrge', logoQuality: 1 }), cand('awork'), now)).toBe(true);
    expect(shouldTake(company(), cand('hrge'), now)).toBe(false);
    expect(shouldTake(company(), cand('linkedin'), now)).toBe(false);
  });

  it('refreshes when a stable source shows a new URL, but not for hr.ge per-vacancy URLs', () => {
    expect(shouldTake(company(), cand('myjobs', 'https://a/logo.png?v=3'), now)).toBe(true);
    expect(shouldTake(company(), cand('myjobs', 'https://a/logo.png'), now)).toBe(false);
    const hr = company({ logoSource: 'hrge', logoQuality: 1, logoSourceUrl: 'https://cf/announcementfiles/1/a.png' });
    expect(shouldTake(hr, cand('hrge', 'https://cf/announcementfiles/2/a.png'), now)).toBe(false);
  });

  it('retries a failed URL only after a week, a different URL right away', () => {
    const failed = company({ logoStatus: LogoStatus.FAILED, logoSourceUrl: 'https://b/logo.png', logoCheckedAt: new Date('2026-10-27') });
    expect(shouldTake(failed, cand('myjobs'), now)).toBe(false);
    expect(shouldTake({ ...failed, logoCheckedAt: new Date('2026-10-10') }, cand('myjobs'), now)).toBe(true);
    expect(shouldTake(failed, cand('myjobs', 'https://c/other.png'), now)).toBe(true);
  });

  it('does not queue the same pending URL twice, unless it has been stuck for a day', () => {
    const pending = company({ logoStatus: LogoStatus.PENDING, logoSourceUrl: 'https://b/logo.png', updatedAt: new Date('2026-10-28T20:00:00Z') });
    expect(shouldTake(pending, cand('myjobs'), now)).toBe(false);
    expect(shouldTake({ ...pending, updatedAt: new Date('2026-10-27') }, cand('myjobs'), now)).toBe(true);
  });
});

describe('bestPerKey', () => {
  it('keeps the best source per company', () => {
    const best = bestPerKey([
      { key: 'tbc', company: 'TBC', source: 'hrge', url: 'h' },
      { key: 'tbc', company: 'TBC', source: 'myjobs', url: 'm' },
      { key: 'tbc', company: 'TBC', source: 'linkedin', url: 'l' },
      { key: 'bog', company: 'BOG', source: 'jobsge', url: 'j' },
    ]);
    expect(best.get('tbc')!.url).toBe('m');
    expect(best.get('bog')!.url).toBe('j');
  });
});

describe('processLogo', () => {
  it('makes 128 and 256 px WebP, keeping the shape and never upscaling', async () => {
    const big = await processLogo(await png(800, 800));
    expect(big).not.toBeNull();
    expect(await sharp(big!.small).metadata()).toMatchObject({ format: 'webp', width: 128, height: 128 });
    expect(await sharp(big!.large).metadata()).toMatchObject({ width: 256, height: 256 });
    expect(big!.hash).toMatch(/^[0-9a-f]{12}$/);

    // hr.ge-style small banner: fits inside, stays its own size
    const banner = await processLogo(await png(115, 26));
    expect(await sharp(banner!.small).metadata()).toMatchObject({ width: 115, height: 26 });
  });

  it('rejects SVG, tiny and broken images', async () => {
    expect(await processLogo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>'))).toBeNull();
    expect(await processLogo(await png(10, 10))).toBeNull();
    expect(await processLogo(Buffer.from('not an image'))).toBeNull();
  });

  it('gives the same hash for the same image', async () => {
    const image = await png(300, 300);
    expect((await processLogo(image))!.hash).toBe((await processLogo(image))!.hash);
  });
});

describe('jobs.ge company page', () => {
  it('prefers the page logo over the listing icon', () => {
    const page = 'https://jobs.ge/ge/?view=client&client=nikora-trade';
    expect(isJobsGeCompanyPage(page)).toBe(true);
    expect(isJobsGeCompanyPage('https://jobs.ge/ge/?view=jobs&id=1')).toBe(false);
    const html = '<img src="/data/clients/logo_icon/11178.gif"><img src="/data/clients/logo/11178_100_nikoratrade_2799555.gif">';
    expect(findJobsGeLogo(html, page)).toBe('https://jobs.ge/data/clients/logo/11178_100_nikoratrade_2799555.gif');
    expect(findJobsGeLogo('<img src="/data/clients/logo_icon/5.gif">', page)).toBe('https://jobs.ge/data/clients/logo_icon/5.gif');
    expect(findJobsGeLogo('<p>none</p>', page)).toBeNull();
  });
});
