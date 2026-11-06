import { CvSummaryDetails } from 'src/cv/dto/cv-summary.dto';
import { fitsWithoutKeywords, scoreCvForCriteria } from './candidate-score';

const summary: CvSummaryDetails = {
  detectedRole: 'Frontend Developer',
  seniorityLevel: 'Mid',
  primarySkills: ['Angular', 'TypeScript', 'React.js'],
  secondarySkills: ['Docker'],
  domains: ['Fintech'],
  locationPreference: 'Tbilisi',
  careerDirection: 'Senior Frontend Developer',
  searchQueries: ['Frontend Developer', 'Angular Developer'],
};

describe('scoreCvForCriteria', () => {
  it('scores a role + skill match near the top', () => {
    const r = scoreCvForCriteria(summary, { keywords: ['Frontend Developer', 'TypeScript'] })!;
    expect(r.match).toBeGreaterThanOrEqual(85);
    expect(r.matchedKeywords).toEqual(expect.arrayContaining(['frontend developer', 'typescript']));
  });

  it('ranks the CV\'s own role above a related title', () => {
    const own = scoreCvForCriteria(summary, { keywords: ['Frontend Developer'] })!;
    const related = scoreCvForCriteria(summary, { keywords: ['Angular Developer'] })!;
    expect(own.match).toBeGreaterThan(related.match);
  });

  it('matches skills in either direction ("React" ~ "React.js")', () => {
    expect(scoreCvForCriteria(summary, { keywords: ['React'] })).not.toBeNull();
  });

  it('excludes CVs no keyword hits', () => {
    expect(scoreCvForCriteria(summary, { keywords: ['Accountant'] })).toBeNull();
  });

  it('does not match partial words', () => {
    expect(scoreCvForCriteria(summary, { keywords: ['Angu'] })).toBeNull();
  });

  it('excludes CVs 2+ seniority levels off and rewards an exact level', () => {
    expect(scoreCvForCriteria(summary, { keywords: ['Angular'], seniority: 'Lead' })).toBeNull();
    const exact = scoreCvForCriteria(summary, { keywords: ['Angular'], seniority: 'Mid' })!;
    const near = scoreCvForCriteria(summary, { keywords: ['Angular'], seniority: 'Senior' })!;
    expect(exact.match).toBeGreaterThan(near.match);
  });

  it('Entry (no experience): only Junior CVs, and under a year of work when the summary knows the years', () => {
    const entry = { keywords: ['Angular'], seniority: 'Entry' as const };
    expect(scoreCvForCriteria(summary, entry)).toBeNull(); // Mid
    expect(scoreCvForCriteria({ ...summary, seniorityLevel: 'Junior' }, entry)).not.toBeNull(); // years unknown
    expect(scoreCvForCriteria({ ...summary, seniorityLevel: 'Junior', yearsOfExperience: 0 }, entry)).not.toBeNull();
    expect(scoreCvForCriteria({ ...summary, seniorityLevel: 'Junior', yearsOfExperience: 1.5 }, entry)).toBeNull();
  });

  it('counts a keyword found only in employers, universities or languages, below a role or skill match', () => {
    const withFacts = { ...summary, companies: ['TBC Bank'], universities: ['Free University of Tbilisi'] };
    expect(scoreCvForCriteria(summary, { keywords: ['TBC Bank'] })).toBeNull();
    const factOnly = scoreCvForCriteria(withFacts, { keywords: ['TBC Bank'] })!;
    const skill = scoreCvForCriteria(withFacts, { keywords: ['Angular'] })!;
    expect(factOnly.matchedKeywords).toEqual(['tbc bank']);
    expect(skill.match).toBeGreaterThan(factOnly.match);
  });

  it('prefers a matching location', () => {
    const here = scoreCvForCriteria(summary, { keywords: ['Angular'], location: 'Tbilisi' })!;
    const there = scoreCvForCriteria(summary, { keywords: ['Angular'], location: 'Batumi' })!;
    expect(here.match).toBeGreaterThan(there.match);
  });
});

describe('fitsWithoutKeywords (filters-only search)', () => {
  it('takes the exact experience level, or Entry', () => {
    expect(fitsWithoutKeywords(summary, { seniority: 'Mid' })).toBe(true);
    expect(fitsWithoutKeywords(summary, { seniority: 'Senior' })).toBe(false);
    expect(fitsWithoutKeywords(summary, { seniority: 'Entry' })).toBe(false);
    expect(fitsWithoutKeywords({ ...summary, seniorityLevel: 'Junior', yearsOfExperience: 0 }, { seniority: 'Entry' })).toBe(true);
    expect(fitsWithoutKeywords({ ...summary, seniorityLevel: 'Junior', yearsOfExperience: 2 }, { seniority: 'Entry' })).toBe(false);
  });

  it('drops only CVs that name a different city', () => {
    expect(fitsWithoutKeywords(summary, { location: 'Tbilisi' })).toBe(true);
    expect(fitsWithoutKeywords(summary, { location: 'Batumi' })).toBe(false);
    expect(fitsWithoutKeywords({ ...summary, locationPreference: 'Not specified' }, { location: 'Batumi' })).toBe(true);
    expect(fitsWithoutKeywords({ ...summary, locationPreference: 'Remote' }, { location: 'Batumi' })).toBe(true);
  });
});
