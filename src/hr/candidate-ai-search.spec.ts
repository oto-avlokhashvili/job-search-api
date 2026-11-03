import { CvSummaryDetails } from 'src/cv/dto/cv-summary.dto';
import { buildRankPrompt, parseExpandedQuery, parseRankings, toCvRankItem, toLinkedinRankItem } from './candidate-ai-search';

describe('parseExpandedQuery', () => {
  it('keeps clean keywords, titles and valid seniority/location', () => {
    expect(
      parseExpandedQuery({
        keywords: [' React ', 'fintech', 42, ''],
        titles: ['React Developer', 'Frontend Developer'],
        seniority: 'Senior',
        location: ' Tbilisi ',
      }),
    ).toEqual({
      keywords: ['React', 'fintech'],
      titles: ['React Developer', 'Frontend Developer'],
      seniority: 'Senior',
      location: 'Tbilisi',
    });
  });

  it('drops an unknown seniority and an empty location; titles fall back to the first keywords', () => {
    expect(parseExpandedQuery({ keywords: ['accountant', 'ifrs', 'audit', 'excel'], seniority: 'Expert', location: ' ' })).toEqual({
      keywords: ['accountant', 'ifrs', 'audit', 'excel'],
      titles: ['accountant', 'ifrs', 'audit'],
      seniority: undefined,
      location: undefined,
    });
  });

  it('is null when no keyword survives', () => {
    expect(parseExpandedQuery({ keywords: [] })).toBeNull();
    expect(parseExpandedQuery(null)).toBeNull();
  });
});

describe('parseRankings', () => {
  const pool = new Set(['cv:1', 'cv:2', 'li:0']);

  it('keeps pool ids only, once each, best first, with match clamped to 0-100', () => {
    const r = parseRankings(
      {
        results: [
          { id: 'cv:2', match: 70, reason: 'Angular dev', missing: ['fintech'] },
          { id: 'cv:99', match: 95, reason: 'invented' },
          { id: 'li:0', match: 120, reason: 'React lead', missing: 'none', unverified: ['5+ years'] },
          { id: 'cv:2', match: 10 },
          { id: 'cv:1', match: 'high' },
        ],
      },
      pool,
    );
    expect(r).toEqual([
      { id: 'li:0', match: 100, reason: 'React lead', missing: [], unverified: ['5+ years'] },
      { id: 'cv:2', match: 70, reason: 'Angular dev', missing: ['fintech'], unverified: [] },
    ]);
  });

  it('is null when the answer has no results array, so the caller falls back', () => {
    expect(parseRankings({ topJobs: [] }, pool)).toBeNull();
    expect(parseRankings(null, pool)).toBeNull();
  });
});

describe('buildRankPrompt', () => {
  it('sends CV summary fields and LinkedIn headline/snippet only, never names or contacts', () => {
    const summary: CvSummaryDetails = {
      detectedRole: 'Accountant',
      seniorityLevel: 'Mid',
      primarySkills: ['IFRS'],
      secondarySkills: [],
      domains: ['Banking'],
      locationPreference: 'Tbilisi',
      careerDirection: 'Financial Analyst',
      searchQueries: [],
    };
    const prompt = buildRankPrompt('IFRS accountant', [
      toCvRankItem(5, summary),
      toLinkedinRankItem(0, { name: 'Nino Beridze', headline: 'Senior Accountant at TBC', url: 'https://www.linkedin.com/in/nino', snippet: 'IFRS, SAP' }),
    ]);
    expect(prompt).toContain('"id":"cv:5"');
    expect(prompt).toContain('"role":"Accountant"');
    expect(prompt).toContain('"id":"li:0"');
    expect(prompt).toContain('Senior Accountant at TBC');
    expect(prompt).not.toContain('Nino');
    expect(prompt).not.toContain('linkedin.com/in');
    expect(prompt).not.toMatch(/email|phone|fullName/i);
  });
});
