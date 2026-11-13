import { jobPageUrl } from './public-link';

describe('public-link', () => {
  it('opens LinkedIn and Job Up links directly, everything else on its Job Up page', () => {
    expect(jobPageUrl({ id: 7, link: 'https://jobs.ge/ge/?id=7' })).toMatch(/\/vacancies\/7$/);
    expect(jobPageUrl({ id: 8, link: 'https://www.linkedin.com/jobs/view/8' })).toBe('https://www.linkedin.com/jobs/view/8');
    expect(jobPageUrl({ id: 9, link: 'https://fake-linkedin.com.evil.ge/x' })).toMatch(/\/vacancies\/9$/);
    expect(jobPageUrl({ id: null, link: null })).toMatch(/\/vacancies$/);
  });
});
