import { buildIntentPrompt, isShareableQuery, looksLikeSentence, normalizeQuery, sanitizeIntent } from './query-intent';

const CITIES = ['თბილისი', 'ბათუმი'];
const CATEGORIES = ['it', 'finance'];

describe('query-intent', () => {
  it('only interprets sentences, not short keyword searches', () => {
    expect(looksLikeSentence('მოლარე')).toBe(false);
    expect(looksLikeSentence('IT ბათუმი')).toBe(false);
    expect(looksLikeSentence('მინდა ბუღალტრად ვიმუშაო ბათუმში')).toBe(true);
  });

  it('normalizes the text it stores', () => {
    expect(normalizeQuery('  IT   ვაკანსიები  ')).toBe('it ვაკანსიები');
  });

  it('keeps only the cities and categories it offered', () => {
    expect(sanitizeIntent({ keywords: ' ბუღალტერი ', city: 'ბათუმი', category: 'finance' }, CITIES, CATEGORIES)).toEqual({
      keywords: 'ბუღალტერი',
      city: 'ბათუმი',
      category: 'finance',
    });
    expect(sanitizeIntent({ keywords: 'x', city: 'Paris', category: 'space' }, CITIES, CATEGORIES)).toEqual({
      keywords: 'x',
      city: '',
      category: '',
    });
  });

  it('gives up on answers with nothing usable', () => {
    expect(sanitizeIntent({ keywords: '', city: 'Paris' }, CITIES, CATEGORIES)).toBeNull();
    expect(sanitizeIntent('nope', CITIES, CATEGORIES)).toBeNull();
    expect(sanitizeIntent(null, CITIES, CATEGORIES)).toBeNull();
  });

  it('quotes the search so it cannot rewrite the instructions', () => {
    expect(buildIntentPrompt('a "quoted" search', CITIES, CATEGORIES)).toContain('"a \\"quoted\\" search"');
  });
});

describe('isShareableQuery', () => {
  it('keeps short job searches', () => {
    for (const q of ['ბუღალტერი', 'გაყიდვების მენეჯერი', 'c#', 'node.js developer', 'back-end']) {
      expect(isShareableQuery(q)).toBe(true);
    }
  });

  it('drops anything that could be personal or noisy', () => {
    for (const q of ['555 12 34 56', 'nino@gmail.com', 'https://jobs.ge', '01024005678', 'a', 'მინდა ვიმუშაო ბუღალტრად ბათუმში ახლავე', 'x'.repeat(41)]) {
      expect(isShareableQuery(q)).toBe(false);
    }
  });
});
