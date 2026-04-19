export type SeniorityLevel = 'Junior' | 'Mid' | 'Senior' | 'Lead' | 'Principal';
export interface CvSummaryDetails {
  detectedRole: string;
  seniorityLevel: SeniorityLevel;
  primarySkills: string[];
  secondarySkills: string[];
  domains: string[];
  locationPreference: string;
  careerDirection: string;
}