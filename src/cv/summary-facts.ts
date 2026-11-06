import { CvSummaryDetails } from './dto/cv-summary.dto';
import { GEORGIAN_UNIVERSITIES } from './georgian-universities';

const canonicalUniversities = new Map<string, string>();
for (const u of GEORGIAN_UNIVERSITIES) {
  for (const n of [u.name, ...(u.aliases ?? [])]) canonicalUniversities.set(n.trim().toLowerCase(), u.name);
}

// "EY Georgia LLC" -> "EY Georgia"; "შპს თიბისი" -> "თიბისი"
const LEGAL_SUFFIX = /[\s,]+(llc|l\.l\.c\.|ltd\.?|limited|jsc|inc\.?|corp\.?|gmbh|შპს|სს)$/i;
const LEGAL_PREFIX = /^(შპს|სს|llc|jsc)\s+/i;

const cleanList = (value: unknown, max: number): string[] =>
  Array.isArray(value)
    ? Array.from(new Set(value.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean))).slice(0, max)
    : [];

/**
 * Tidies the AI's HR filter facts: a Georgian university written any known way becomes its list name
 * (so the filter matches it exactly), legal suffixes come off company names, lists are deduplicated.
 */
export function normalizeSummaryFacts<T extends Partial<CvSummaryDetails>>(summary: T): T {
  const universities = cleanList(summary.universities, 4).map((u) => canonicalUniversities.get(u.toLowerCase()) ?? u);
  const companies = cleanList(summary.companies, 8).map((c) => c.replace(LEGAL_SUFFIX, '').replace(LEGAL_PREFIX, '').trim()).filter(Boolean);
  const years = Number(summary.yearsOfExperience);
  return {
    ...summary,
    companies: Array.from(new Set(companies)),
    universities: Array.from(new Set(universities)),
    languages: cleanList(summary.languages, 6),
    yearsOfExperience: Number.isFinite(years) && years >= 0 ? Math.round(years * 10) / 10 : undefined,
  };
}
