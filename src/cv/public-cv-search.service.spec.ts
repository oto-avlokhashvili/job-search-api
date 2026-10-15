import { scoreJobForCv } from './public-cv-search.service';
import { CvSummaryDetails } from './dto/cv-summary.dto';

const summary: CvSummaryDetails = {
  detectedRole: 'Frontend Developer',
  seniorityLevel: 'Mid',
  primarySkills: ['angular', 'typescript', 'rxjs'],
  secondarySkills: ['scss', 'git'],
  domains: ['web development'],
  locationPreference: 'Tbilisi',
  careerDirection: 'Frontend engineering',
  searchQueries: ['angular developer', 'frontend developer'],
};

describe('scoreJobForCv', () => {
  it('scores a matching role with overlapping skills high', () => {
    const { match, matchedKeywords } = scoreJobForCv(
      { vacancy: 'Frontend Developer', description: 'Angular, TypeScript, RxJS and SCSS', location: 'Tbilisi' },
      summary,
    );
    expect(match).toBeGreaterThanOrEqual(80);
    expect(matchedKeywords).toEqual(expect.arrayContaining(['frontend developer', 'angular', 'typescript']));
  });

  it('scores an unrelated role low', () => {
    const { match } = scoreJobForCv(
      { vacancy: 'Sales Manager', description: 'Retail sales and customer service', location: 'Batumi' },
      summary,
    );
    expect(match).toBeLessThan(30);
  });

  it('penalizes a title two or more seniority levels away', () => {
    const base = { description: 'Angular, TypeScript', location: 'Tbilisi' };
    const mid = scoreJobForCv({ vacancy: 'Frontend Developer', ...base }, summary).match;
    const lead = scoreJobForCv({ vacancy: 'Lead Frontend Developer', ...base }, { ...summary, seniorityLevel: 'Junior' }).match;
    expect(lead).toBeLessThan(mid);
  });

  it('does not match skills inside other words', () => {
    const { matchedKeywords } = scoreJobForCv(
      { vacancy: 'Designer', description: 'legit portfolio', location: '' },
      summary,
    );
    expect(matchedKeywords).not.toContain('git');
  });
});
