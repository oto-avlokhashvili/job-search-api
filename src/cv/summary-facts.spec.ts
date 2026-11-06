import { normalizeSummaryFacts } from './summary-facts';

describe('normalizeSummaryFacts', () => {
  it('writes a known university by its list name', () => {
    const out = normalizeSummaryFacts({ universities: ['Tbilisi State University', 'ილიას სახელმწიფო უნივერსიტეტი', 'MIT'] });
    expect(out.universities).toEqual(['Tbilisi Ivane Javakhishvili State University', 'Ilia State University', 'MIT']);
  });

  it('strips legal forms from companies and dedupes', () => {
    const out = normalizeSummaryFacts({ companies: ['EY Georgia LLC', 'Nexia Georgia LLC', 'შპს თიბისი', 'EY Georgia'] });
    expect(out.companies).toEqual(['EY Georgia', 'Nexia Georgia', 'თიბისი']);
  });

  it('keeps sane years and drops junk', () => {
    expect(normalizeSummaryFacts({ yearsOfExperience: 1.56 }).yearsOfExperience).toBe(1.6);
    expect(normalizeSummaryFacts({ yearsOfExperience: 'x' as any }).yearsOfExperience).toBeUndefined();
    expect(normalizeSummaryFacts({ languages: undefined }).languages).toEqual([]);
  });
});

describe('canonicalUniversity', () => {
  it('finds a known name inside a longer one, preferring the longest', () => {
    const { canonicalUniversity } = require('./summary-facts');
    expect(canonicalUniversity('Ivane Javakhishvili Tbilisi State University (TSU), Faculty of Law')).toBe('Tbilisi Ivane Javakhishvili State University');
    expect(canonicalUniversity('East European University, Tbilisi')).toBe('East European University');
    expect(canonicalUniversity('ილიას სახელმწიფო უნივერსიტეტი, ბიზნესის სკოლა')).toBe('Ilia State University');
    expect(canonicalUniversity('Harvard University')).toBe('Harvard University');
  });
});
