export type SeniorityLevel = 'Junior' | 'Mid' | 'Senior' | 'Lead' | 'Principal';

/**
 * Bump whenever the CV summary prompt changes in a way that affects searchQueries/domains,
 * so stored summaries built by the older prompt get regenerated on the next daily run.
 */
export const CV_SUMMARY_PROMPT_VERSION = 2;

export interface CvSummaryDetails {
  detectedRole: string;
  seniorityLevel: SeniorityLevel;
  primarySkills: string[];
  secondarySkills: string[];
  domains: string[];
  locationPreference: string;
  careerDirection: string;
  searchQueries: string[];
  // Facts for the HR filters. Missing on summaries made before they were added, until the CV is
  // re-analyzed (CvService.startReanalysis).
  /** Employers, most recent first */
  companies?: string[];
  /** Universities and colleges; Georgian ones by their GEORGIAN_UNIVERSITIES name */
  universities?: string[];
  /** Spoken languages, in English ("English", "Russian") */
  languages?: string[];
  /** Total paid work experience in years (0 = none yet) */
  yearsOfExperience?: number;
  promptVersion?: number;
}
