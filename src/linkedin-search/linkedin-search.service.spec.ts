import { LinkedinSearchService } from './linkedin-search.service';
import { GoogleBrowserService } from './google-browser.service';
import { PublicCvLimitsService } from 'src/cv/public-cv-limits.service';
import { SearloSearchService } from './searlo-search.service';

describe('LinkedinSearchService.buildQuery', () => {
  const service = new LinkedinSearchService({} as GoogleBrowserService, {} as PublicCvLimitsService, {} as SearloSearchService);
  const openToWork = '("open to work" OR "#opentowork" OR "looking for new opportunities")';

  it('builds a query with keyword and location', () => {
    expect(service.buildQuery('Angular', 'Tbilisi')).toBe(
      'site:linkedin.com/in ("Angular") "Tbilisi"',
    );
  });

  it('ORs comma-separated keywords and omits missing location', () => {
    expect(service.buildQuery('Angular, React ,')).toBe(
      'site:linkedin.com/in ("Angular" OR "React")',
    );
  });

  it('adds OR-ed companies', () => {
    expect(service.buildQuery('Accountant', 'Tbilisi', { company: 'TBC Bank, Bank of Georgia' })).toBe(
      'site:linkedin.com/in ("Accountant") "Tbilisi" ("TBC Bank" OR "Bank of Georgia")',
    );
  });

  it('ORs a university with its other names, and requires each skill and language', () => {
    expect(
      service.buildQuery('Developer', undefined, {
        university: 'Tbilisi Ivane Javakhishvili State University, Some College',
        skills: 'React, TypeScript',
        languages: 'English',
        openToWork: false,
      }),
    ).toBe(
      'site:linkedin.com/in ("Developer") ("Tbilisi Ivane Javakhishvili State University" OR ' +
        '"Ivane Javakhishvili Tbilisi State University" OR "Tbilisi State University" OR "Some College") ' +
        '"React" "TypeScript" "English"',
    );
  });

  it('adds the open-to-work clause only when asked for', () => {
    expect(service.buildQuery('Accountant', undefined, { company: ' , ' })).toBe('site:linkedin.com/in ("Accountant")');
    expect(service.buildQuery('Accountant', undefined, { openToWork: true })).toBe(
      `site:linkedin.com/in ("Accountant") ${openToWork}`,
    );
  });

  it('strips user-supplied quotes', () => {
    expect(service.buildQuery('"Node.js"', '"Batumi"')).toBe(
      'site:linkedin.com/in ("Node.js") "Batumi"',
    );
  });
});
