import { BLOCKED_COMPANY_KEYS, isBlockedCompany } from './blocked-companies';

describe('isBlockedCompany', () => {
  it.each(['ისი პარი', 'ისიპარი', ' შპს „ისი პარი“ ', 'ISI PARI', 'Isi Pari LLC'])('blocks %s', (name) => {
    expect(isBlockedCompany(name)).toBe(true);
  });

  it.each(['ისი პარის მეგობარი', 'პარი', 'Acme', '', null, undefined])('lets %s through', (name) => {
    expect(isBlockedCompany(name)).toBe(false);
  });

  it('never holds an empty key, which would match every unnamed company', () => {
    expect(BLOCKED_COMPANY_KEYS).not.toContain('');
  });
});
