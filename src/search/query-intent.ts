/** What the AI understood from a free-text search; pure helpers, so they can be tested without Gemini. */

export interface QueryIntent {
  /** Job-title words to search for, e.g. "ბუღალტერი"; '' = none */
  keywords: string;
  /** One of the known cities ('თბილისი', 'ბათუმი', ...); '' = none */
  city: string;
  /** One of the category keys ('it', 'finance', ...); '' = none */
  category: string;
}

/** Short searches ("მოლარე", "IT ბათუმი") are already keywords; longer ones are sentences worth interpreting. */
export function looksLikeSentence(query: string): boolean {
  return query.trim().split(/\s+/).filter(Boolean).length >= 3;
}

export function normalizeQuery(query: string): string {
  return query.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200);
}

/**
 * Whether a recorded search may be shown to everyone as a "frequently searched" chip: short and made of
 * words only. No digits, "@" or links, so a phone number, e-mail, ID or URL someone typed never shows.
 */
export function isShareableQuery(query: string): boolean {
  const text = query.trim();
  if (text.length < 2 || text.length > 40) return false;
  if (text.split(' ').length > 4) return false;
  // Letters, spaces and the few marks job titles use (C#, C++, Node.js, back-end)
  return /^[\p{L}][\p{L}\s.+#-]*$/u.test(text);
}

export function buildIntentPrompt(query: string, cities: string[], categories: string[]): string {
  return `You turn a job seeker's search, written in Georgian or English, into search filters for a Georgian job site.
Return JSON: {"keywords": string, "city": string, "category": string}.
- keywords: the job title or profession only, 1-3 words, in the language and spelling the person used; drop filler words ("მინდა", "ვეძებ", "სამსახური", "ვაკანსია", "job", "work") and the city. '' if there is none.
- city: exactly one of ${JSON.stringify(cities)}, or ''.
- category: exactly one of ${JSON.stringify(categories)} when the search clearly fits it, or ''.
Search: ${JSON.stringify(query.slice(0, 300))}`;
}

/** Keeps only what the prompt allowed: anything else the model invents is dropped. */
export function sanitizeIntent(raw: unknown, cities: string[], categories: string[]): QueryIntent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const intent: QueryIntent = {
    keywords: str(r.keywords).slice(0, 60),
    city: cities.includes(str(r.city)) ? str(r.city) : '',
    category: categories.includes(str(r.category)) ? str(r.category) : '',
  };
  return intent.keywords || intent.city || intent.category ? intent : null;
}
