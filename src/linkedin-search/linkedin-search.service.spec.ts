import { LinkedinSearchService } from './linkedin-search.service';
import { GoogleBrowserService } from './google-browser.service';

describe('LinkedinSearchService.buildQuery', () => {
  const service = new LinkedinSearchService({} as GoogleBrowserService);
  const openToWork = '("open to work" OR "#opentowork" OR "looking for new opportunities")';

  it('builds a query with keyword and location', () => {
    expect(service.buildQuery('Angular', 'Tbilisi')).toBe(
      `site:linkedin.com/in ("Angular") "Tbilisi" ${openToWork}`,
    );
  });

  it('ORs comma-separated keywords and omits missing location', () => {
    expect(service.buildQuery('Angular, React ,')).toBe(
      `site:linkedin.com/in ("Angular" OR "React") ${openToWork}`,
    );
  });

  it('strips user-supplied quotes', () => {
    expect(service.buildQuery('"Node.js"', '"Batumi"')).toBe(
      `site:linkedin.com/in ("Node.js") "Batumi" ${openToWork}`,
    );
  });
});
