import { CvSummaryDetails, SeniorityLevel } from 'src/cv/dto/cv-summary.dto';
import { containsWord, LEVEL_ORDER } from 'src/cv/public-cv-search.service';

/** The HR form's hard filters on CVs: applied in SQL, not part of the score. */
export interface CandidateFilters {
  /** Current or past employers, any of them */
  companies?: string[];
  /** Universities studied at, any of them */
  universities?: string[];
  /** Skills, all of them */
  skills?: string[];
  /** Spoken languages, all of them */
  languages?: string[];
}

/** The HR experience filter: a seniority level, or Entry = no work experience yet */
export type ExperienceFilter = SeniorityLevel | 'Entry';
export const EXPERIENCE_FILTERS: ExperienceFilter[] = ['Entry', 'Junior', 'Mid', 'Senior', 'Lead', 'Principal'];

/** Below this, a CV counts as having no work experience */
const ENTRY_MAX_YEARS = 1;

/** No work experience yet: Junior, and under a year of work where the summary knows the years */
const fitsEntry = (summary: CvSummaryDetails) =>
  summary.seniorityLevel === 'Junior' &&
  !(typeof summary.yearsOfExperience === 'number' && summary.yearsOfExperience >= ENTRY_MAX_YEARS);

/**
 * A search with filters only (no keyword) has nothing to score, so experience and location become
 * plain filters: the exact level (or Entry), and no CV that names a different city (remote and
 * unspecified locations stay in).
 */
export function fitsWithoutKeywords(summary: CvSummaryDetails, criteria: Omit<CandidateCriteria, 'keywords'>): boolean {
  if (criteria.seniority === 'Entry' ? !fitsEntry(summary) : criteria.seniority && summary.seniorityLevel !== criteria.seniority) {
    return false;
  }
  const wanted = (criteria.location || '').trim().toLowerCase();
  const pref = (summary.locationPreference || '').trim().toLowerCase();
  const specified = pref && pref !== 'not specified';
  if (wanted && specified && !pref.includes(wanted) && !wanted.includes(pref) && !/remote|დისტანციურ/.test(pref)) return false;
  return true;
}

export interface CandidateCriteria extends CandidateFilters {
  keywords: string[];
  location?: string;
  seniority?: ExperienceFilter;
}

/** Either side contains the other as a whole word: "React" ~ "React.js", "React Native developer" ~ "React Native". */
const matches = (a: string, b: string) => containsWord(a.toLowerCase(), b) || containsWord(b.toLowerCase(), a);

/**
 * Deterministic HR-search-to-CV score (0-100), the reverse of scoreJobForCv: role fit (60 for the
 * CV's own role, 45 for a related title), skills (25), domain (5), seniority (10), location (5),
 * capped at 100. Returns null when no keyword hits the
 * CV at all, or when the requested seniority is 2+ levels off.
 */
export function scoreCvForCriteria(
  summary: CvSummaryDetails,
  criteria: CandidateCriteria,
): { match: number; matchedKeywords: string[] } | null {
  const keywords = criteria.keywords.map((k) => k.trim()).filter(Boolean);
  const hits = new Set<string>();
  let score = 0;

  // Role fit: the CV's own role counts most, then its direction and the job titles it searches for
  const ownRoleHits = keywords.filter((k) => summary.detectedRole && matches(summary.detectedRole, k));
  const relatedRoleTexts = [summary.careerDirection, ...(summary.searchQueries || [])].filter(Boolean);
  const relatedRoleHits = keywords.filter((k) => relatedRoleTexts.some((r) => matches(r, k)));
  if (ownRoleHits.length) score += 60;
  else if (relatedRoleHits.length) score += 45;
  [...ownRoleHits, ...relatedRoleHits].forEach((k) => hits.add(k.toLowerCase()));

  // Skills
  const primaryHits = keywords.filter((k) => (summary.primarySkills || []).some((s) => matches(s, k)));
  const secondaryHits = keywords.filter((k) => (summary.secondarySkills || []).some((s) => matches(s, k)));
  score += Math.min(primaryHits.length * 12, 20) + Math.min(secondaryHits.length * 5, 5);
  [...primaryHits, ...secondaryHits].forEach((k) => hits.add(k.toLowerCase()));

  // Domain / industry
  const domainHits = keywords.filter((k) => (summary.domains || []).some((d) => matches(d, k)));
  if (domainHits.length) score += 5;
  domainHits.forEach((k) => hits.add(k.toLowerCase()));

  // Employers, universities, languages: a keyword found only there still counts, below role and skills
  if (hits.size === 0) {
    const facts = [...(summary.companies || []), ...(summary.universities || []), ...(summary.languages || [])];
    const factHits = keywords.filter((k) => facts.some((f) => matches(f, k)));
    score += Math.min(factHits.length * 15, 30);
    factHits.forEach((k) => hits.add(k.toLowerCase()));
  }

  if (hits.size === 0) return null;

  // Seniority: full points when not requested, so scores stay comparable across searches.
  if (criteria.seniority === 'Entry') {
    if (!fitsEntry(summary)) return null;
    score += 10;
  } else if (criteria.seniority) {
    const wanted = LEVEL_ORDER.indexOf(criteria.seniority);
    const actual = LEVEL_ORDER.indexOf(summary.seniorityLevel);
    const distance = actual < 0 ? 1 : Math.abs(wanted - actual);
    if (distance >= 2) return null;
    score += distance === 0 ? 10 : 3;
  } else {
    score += 10;
  }

  // Location
  const wantedLocation = (criteria.location || '').trim().toLowerCase();
  const pref = (summary.locationPreference || '').toLowerCase();
  if (!wantedLocation || (pref && pref !== 'not specified' && (pref.includes(wantedLocation) || wantedLocation.includes(pref)))) {
    score += 5;
  } else if (/remote|დისტანციურ/.test(pref)) {
    score += 2;
  }

  return { match: Math.min(100, score), matchedKeywords: Array.from(hits).slice(0, 6) };
}
