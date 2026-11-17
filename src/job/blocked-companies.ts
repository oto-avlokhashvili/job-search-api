import { companyKey } from 'src/companies/company-key';

/**
 * Employers who asked us not to list their vacancies. Matched by companyKey, so case, spacing, quotes
 * and legal forms ("შპს ...", "... LLC") don't matter; add the Latin spelling too when they use one.
 * Saving skips these, and cleanupListings deletes any already in the table.
 */
const BLOCKED_COMPANIES = [
  // Asked by email on 2026-11-17
  'ისი პარი',
  'ISI Pari',
];

export const BLOCKED_COMPANY_KEYS: readonly string[] = [...new Set(BLOCKED_COMPANIES.map(companyKey).filter(Boolean))];

const blocked = new Set(BLOCKED_COMPANY_KEYS);

export function isBlockedCompany(company: string | null | undefined): boolean {
  const key = companyKey(company);
  return key !== '' && blocked.has(key);
}
