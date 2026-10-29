// Legal forms dropped before comparing names: "შპს თიბისი" and "თიბისი LLC" are the same company.
const LEGAL_FORMS = [
  'შპს',
  'სს',
  'ააიპ',
  'ა(ა)იპ',
  'ი/მ',
  'იმ',
  'კს',
  'სპს',
  'llc',
  'ltd',
  'jsc',
  'inc',
  'gmbh',
  'plc',
  'corp',
  'co',
];
const LEGAL_FORM_PATTERN = new RegExp(
  `(^|[\\s,.])(${LEGAL_FORMS.map((f) => f.replace(/[()/]/g, '\\$&')).join('|')})\\.?(?=$|[\\s,.])`,
  'gi',
);

/**
 * Key that identifies a company across sources and spellings: lowercase, without legal form,
 * quotes and punctuation. Empty for placeholders such as "კომპანია".
 */
export function companyKey(name: string | null | undefined): string {
  const key = (name ?? '')
    .toLowerCase()
    .replace(/[„“”"«»'`]/g, ' ')
    .replace(LEGAL_FORM_PATTERN, ' ')
    .replace(/[^a-z0-9ა-ჿ]/g, '');
  return PLACEHOLDERS.has(key) ? '' : key;
}

// What scrapers write when a source has no company name
const PLACEHOLDERS = new Set(['კომპანია', 'company', 'na', 'confidential', 'კონფიდენციალური']);
