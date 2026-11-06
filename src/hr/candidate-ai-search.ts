import { CvSummaryDetails, SeniorityLevel } from 'src/cv/dto/cv-summary.dto';
import { LEVEL_ORDER } from 'src/cv/public-cv-search.service';
import type { LinkedinProfile } from 'src/linkedin-search/linkedin-search.service';

/** What the HR's plain-language request is turned into for the keyword prefilter and LinkedIn. */
export interface ExpandedQuery {
  keywords: string[];
  /** Job titles as people write them in a LinkedIn headline: the LinkedIn search ORs these */
  titles: string[];
  seniority?: SeniorityLevel;
  location?: string;
}

/** One ranked result: `cv:<cvId>` from our base or `li:<index>` into the LinkedIn profiles. */
export interface AiRanking {
  id: string;
  /** Null only when the AI was unavailable and a LinkedIn profile couldn't be scored */
  match: number | null;
  reason: string;
  missing: string[];
  /** LinkedIn only: requirements the short snippet says nothing about, to check on the profile */
  unverified: string[];
}

const MAX_KEYWORDS = 15;
const MAX_TITLES = 4;
const MAX_RANKED = 30;

const strings = (value: unknown, max: number, maxLength: number): string[] =>
  Array.isArray(value)
    ? Array.from(new Set(value.filter((v): v is string => typeof v === 'string').map((v) => v.trim().slice(0, maxLength)).filter(Boolean))).slice(0, max)
    : [];

export const cvRankId = (cvId: number) => `cv:${cvId}`;
export const linkedinRankId = (index: number) => `li:${index}`;

export function buildExpandPrompt(query: string): string {
  return `
You turn a recruiter's request into search terms for a CV database and for LinkedIn. CVs are stored as
short English profiles (role, skills, domains), but the request may be in Georgian or English.

Return ONLY this JSON:
{
  "keywords": ["string"],
  "titles": ["string"],
  "seniority": "Junior" | "Mid" | "Senior" | "Lead" | "Principal" | null,
  "location": "string" | null
}

- keywords: up to ${MAX_KEYWORDS} short English terms a matching CV would contain: the role and its common
  synonyms/related titles, the key skills and tools, and the industry. Single words or short phrases
  ("react", "frontend developer", "fintech", "ifrs"), no sentences.
- titles: 2–${MAX_TITLES} job titles exactly as such people write them in a LinkedIn headline
  ("Frontend Developer", "React Developer"), without seniority words.
- seniority: only when the request states or clearly implies it, else null.
- location: a city or "Remote" only when the request mentions one, else null.

RECRUITER REQUEST:
${JSON.stringify(query)}
`.trim();
}

/** Keeps only well-formed fields; null when no keyword survived. */
export function parseExpandedQuery(raw: any): ExpandedQuery | null {
  const keywords = strings(raw?.keywords, MAX_KEYWORDS, 60);
  if (!keywords.length) return null;
  const titles = strings(raw?.titles, MAX_TITLES, 60);
  const seniority = LEVEL_ORDER.includes(raw?.seniority) ? (raw.seniority as SeniorityLevel) : undefined;
  const location = typeof raw?.location === 'string' && raw.location.trim() ? raw.location.trim().slice(0, 100) : undefined;
  return { keywords, titles: titles.length ? titles : keywords.slice(0, 3), seniority, location };
}

/** What the ranking sees of a CV: the AI summary only, never names or contacts. */
export const toCvRankItem = (cvId: number, s: CvSummaryDetails) => ({
  id: cvRankId(cvId),
  source: 'cv' as const,
  role: s.detectedRole,
  seniority: s.seniorityLevel,
  careerDirection: s.careerDirection,
  primarySkills: s.primarySkills,
  secondarySkills: s.secondarySkills,
  domains: s.domains,
  location: s.locationPreference,
  yearsOfExperience: s.yearsOfExperience ?? null,
  companies: s.companies ?? [],
  universities: s.universities ?? [],
  languages: s.languages ?? [],
});

/** What the ranking sees of a LinkedIn result: headline and search snippet, without the name. */
export const toLinkedinRankItem = (index: number, p: LinkedinProfile) => ({
  id: linkedinRankId(index),
  source: 'linkedin' as const,
  headline: p.headline,
  snippet: p.snippet,
});

export type RankItem = ReturnType<typeof toCvRankItem> | ReturnType<typeof toLinkedinRankItem>;

export function buildRankPrompt(query: string, items: RankItem[]): string {
  return `
You are an expert recruiter covering every profession. Rank the candidates below by how well they fit
the recruiter's request. Judge by meaning, not exact wording: related titles, equivalent tools and
transferable experience count.

Candidates come from two sources:
- "cv": a structured profile from a full CV.
- "linkedin": only a LinkedIn headline and a search-result snippet. Score them on what is shown; a
  headline that clearly matches the role is a good fit even if the snippet lists few skills.

Score each candidate 0–100:
- 85–100: clearly fits the role, seniority and the key requirements
- 65–84: fits the role, with some requirements missing or one seniority level off
- 40–64: adjacent role or partial fit
- below 40: does not fit — leave these candidates out

Return ONLY this JSON, at most ${MAX_RANKED} candidates, best first:
{
  "results": [
    { "id": "string", "match": number, "reason": "string", "missing": ["string"], "unverified": ["string"] }
  ]
}

- reason: one short sentence on why this candidate fits, citing their concrete skills or experience.
- missing: up to 3 requirements from the request this candidate does not meet (empty when none).
  - "cv": requirements the profile doesn't show.
  - "linkedin": ONLY requirements the headline or snippet contradicts (e.g. "Junior" when Senior is asked,
    a different city). A requirement that just isn't mentioned is not missing.
- unverified: "linkedin" only, up to 3 requirements the headline and snippet say nothing about, for the
  recruiter to check on the profile (e.g. years of experience, a specific tool). Always empty for "cv".
- Write "reason", "missing" and "unverified" in the language of the recruiter's request.
- Use only ids from the list. Do not invent candidates or facts beyond each profile.

RECRUITER REQUEST:
${JSON.stringify(query)}

CANDIDATES:
${JSON.stringify(items)}
`.trim();
}

/** Drops ids that weren't in the pool, duplicates and malformed rows; best first. */
export function parseRankings(raw: any, poolIds: Set<string>): AiRanking[] | null {
  if (!Array.isArray(raw?.results)) return null;
  const seen = new Set<string>();
  const rankings: AiRanking[] = [];
  for (const r of raw.results) {
    const id = String(r?.id ?? '');
    const match = Math.round(Number(r?.match));
    if (!poolIds.has(id) || seen.has(id) || !Number.isFinite(match)) continue;
    seen.add(id);
    rankings.push({
      id,
      match: Math.max(0, Math.min(100, match)),
      reason: typeof r.reason === 'string' ? r.reason.trim().slice(0, 300) : '',
      missing: strings(r.missing, 3, 80),
      unverified: id.startsWith('li:') ? strings(r.unverified, 3, 80) : [],
    });
  }
  return rankings.sort((a, b) => b.match! - a.match!).slice(0, MAX_RANKED);
}
