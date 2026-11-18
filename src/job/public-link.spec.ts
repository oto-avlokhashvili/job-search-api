import { jobPageUrl } from './public-link';

describe('public-link', () => {
  it('sends the user to the original post', () => {
    expect(jobPageUrl({ id: 7, link: 'https://jobs.ge/ge/?id=7' })).toBe('https://jobs.ge/ge/?id=7');
    expect(jobPageUrl({ id: 8, link: 'https://www.linkedin.com/jobs/view/8' })).toBe('https://www.linkedin.com/jobs/view/8');
  });

  it('falls back to the search (home) when there is no usable link', () => {
    expect(jobPageUrl({ id: 9, link: null })).toMatch(/\/home$/);
    expect(jobPageUrl({ id: 10, link: 'javascript:alert(1)' })).toMatch(/\/home$/);
    expect(jobPageUrl({ id: 11, link: 'not a url' })).toMatch(/\/home$/);
  });
});
