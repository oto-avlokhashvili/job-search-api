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
  promptVersion?: number;
}
