import { CvSummaryDetails } from 'src/cv/dto/cv-summary.dto';
import { scoreCvForCriteria } from './candidate-score';

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

  it('prefers a matching location', () => {
    const here = scoreCvForCriteria(summary, { keywords: ['Angular'], location: 'Tbilisi' })!;
    const there = scoreCvForCriteria(summary, { keywords: ['Angular'], location: 'Batumi' })!;
    expect(here.match).toBeGreaterThan(there.match);
  });
});
