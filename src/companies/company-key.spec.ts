import { companyKey } from './company-key';

describe('companyKey', () => {
  it('ignores legal forms, quotes, punctuation and case', () => {
    const tbc = companyKey('თიბისი');
    expect(companyKey('შპს „თიბისი“')).toBe(tbc);
    expect(companyKey('სს "თიბისი"')).toBe(tbc);
    expect(companyKey('თიბისი, LLC')).toBe(tbc);
    expect(companyKey('New Yorker')).toBe(companyKey('NEW YORKER Ltd.'));
    expect(companyKey('Flutter Central & Eastern Europe')).toBe('fluttercentraleasterneurope');
  });

  it('keeps legal-form letters that are part of a word', () => {
    // "co" inside a name, "სს" inside a Georgian word
    expect(companyKey('Coca-Cola')).toBe('cocacola');
    expect(companyKey('კოკა-კოლა სს')).toBe('კოკაკოლა');
    expect(companyKey('სსიპ განათლება')).toBe('სსიპგანათლება');
  });

  it('gives no key for placeholders and empty names', () => {
    expect(companyKey('კომპანია')).toBe('');
    expect(companyKey('  ')).toBe('');
    expect(companyKey(null)).toBe('');
  });
});
