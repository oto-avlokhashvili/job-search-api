/**
 * The salary a vacancy states, as the text the site shows ("1 500 ლარი", "2 500–3 000 ლარი", "$9/სთ"),
 * or '' when it states none ("შეთანხმებით"). Computed once when a job is saved and stored on it, so
 * the "salary shown" filter and the salary label can't disagree.
 *
 * An amount counts when it sits next to a currency ("2 000 ლარი", "USD 2,000", "500–700$") or right
 * after a salary word ("ხელფასი: 1,500 (NET)"). Ignored: working hours and shifts ("გრაფიკი 11 დან 19",
 * "24 საათიან", "5/2"), "by agreement", loan or turnover sizes ("1 000 000 ლარამდე სესხებს"), bonuses
 * on their own, and implausible amounts.
 */

const SALARY_WORDS = String.raw`ხელფას|ანაზღაურებ|სარგო|შემოსავალ|salary|compensation|wage`;
// 1500 · 1,500 · 1.500 · 1 500 · 2, 500 · 9.00 · 10.63 · 1,500.50
const NUM = String.raw`\d{1,3}(?:(?:[,.]\s?|\s)\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`;
const CUR_BEFORE = String.raw`\$|₾|€|usd\b|gel\b|eur\b`;
const CUR_AFTER = String.raw`ლარ[ა-ჰ]*|ლ\.?(?![ა-ჰ])|₾|\$|€|gel\b|usd\b|eur\b|დოლარ[ა-ჰ]*|ევრო`;
const RANGE_SEP = String.raw`\s*(?:[-–—]|დან|to)\s*`;
const NOTE = String.raw`(?:\s*\((?:net|gross|ნეტო|ხელზე|დარიცხული)\))?`;

const CURRENCY_FIRST = new RegExp(String.raw`(?<![\d.,])(${CUR_BEFORE})\s?(${NUM})(?:${RANGE_SEP}(?:${CUR_BEFORE})?\s?(${NUM}))?`, 'giu');
// "2500-დან ლარი": a "from/up to" ending may sit between the amount and the currency
const AMOUNT_FIRST = new RegExp(String.raw`(?<![\d.,])(${NUM})(?:${RANGE_SEP}(${NUM}))?(\s*-?\s*(?:დან|მდე)|\s*\+)?${NOTE}\s*(${CUR_AFTER})`, 'giu');
// 'd': match indices, to know where the amount itself starts
const AFTER_KEYWORD = new RegExp(String.raw`(?:${SALARY_WORDS})([^\d\n;.]{0,30}?)(?<![\d.,])(${NUM})(?:${RANGE_SEP}(${NUM}))?`, 'giud');

// Loans, turnover, budgets; and company figures ("$18 billion in annual transaction volume")
const NOT_A_SALARY_AFTER = /^([^.\n]{0,15}(სესხ|კრედიტ|ბრუნვ|ბიუჯეტ|loan|turnover|budget)|\s*(billion|million|bn\b|mln\b|მილიონ|მილიარდ))/i;
const NOT_A_SALARY_BEFORE = /(სესხ|loan|ბრუნვ|turnover)[^.\n]{0,25}$/i;
const BONUS_BEFORE = /(ბონუს|bonus|პრემი|საკომისიო|commission)[^.\n]{0,20}$/i;
const SALARY_WORD_BEFORE = new RegExp(String.raw`(${SALARY_WORDS})[^.\n]{0,50}$`, 'i');
// A bare number after a salary word that is really hours, days, a share or a shift ("5/2")
const NOT_MONEY_AFTER = /^\s*(%|\/\s*\d|საათ|სთ|წლ|წელ|დღ|კვირ|თვ|hours?\b|years?\b|days?\b)/i;
const BY_AGREEMENT_OR_SCHEDULE = /შეთანხმ|გრაფიკ|საათ|negotiable/i;
const HOURLY_AFTER = /^\s*(?:\/\s*)?(საათში|სთ|საათი|per hour|an hour|hour\b|hr\b|hourly)/i;
const HOURLY_BEFORE = /(hourly|საათობრივ|საათში)[^.]{0,15}$/i;
// Pay per day or per shift ("დღეში 50 ლარი", "50 ლარი ერთ ცვლაში", "დღე 80 ₾")
// The per-day word may come a few words later: "80-100 ლარი + ბონუსი, ყოველი ცვლის შემდეგ"
const DAILY_AFTER = /^[^.\n\d]{0,30}?(დღეში|დღიურად|ერთ ცვლაში|ცვლაში|ყოველი ცვლის|ცვლა\b|მორიგეობ|per day|a day|daily|\/\s*day\b)/i;
// A bare "დღე" counts only right after the salary word: "5 დღე, 1500 ლარი" is days worked, not daily pay
const DAILY_BEFORE = /(დღეში|დღეზე|დღიური|დღიურად|ცვლაში|daily|per day|(?:ანაზღაურებ|ხელფას)[ა-ჰ]*[:\s-]+დღე)[^.\d]{0,25}$/i;
// Dollar/euro amounts this large are yearly (US listings): "$134,600 - $249,000"
const YEARLY_MIN_FOREIGN = 20_000;
const MAX_YEARLY = 1_000_000;
// "1500+" or "1500-დან" means "at least"; "1500 + ბონუსი" is salary plus a bonus
const FROM_AFTER = /^\s*(\+(?![^.\n]{0,25}(ბონუს|bonus|პრემი|საკომისიო|commission|%))|და მეტი|ზე მეტი|და ზევით|ზევით|-?დან)/i;

const MAX_MONTHLY = 100_000;

type Currency = 'GEL' | 'USD' | 'EUR';

interface Candidate {
  index: number;
  min: number;
  max: number;
  currency: Currency;
  viaSalaryWord: boolean;
  period: 'month' | 'hour' | 'day' | 'year';
  from: boolean;
}

/** "2, 500" → 2500 · "1.500" → 1500 · "9.00" → 9 · "10.63" → 10.63 */
export function parseAmount(raw: string): number {
  const t = raw.replace(/\s/g, '');
  const decimal = /^(.*?)[.,](\d{1,2})$/.exec(t);
  const whole = (decimal ? decimal[1] : t).replace(/[.,]/g, '');
  return Number(whole) + (decimal ? Number(`0.${decimal[2]}`) : 0);
}

const currencyOf = (token: string): Currency =>
  /\$|usd|დოლარ/i.test(token) ? 'USD' : /€|eur|ევრო/i.test(token) ? 'EUR' : 'GEL';

/** Readable text from the stored HTML-ish description */
function plainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/[ \t ]+/g, ' ');
}

function candidate(text: string, index: number, length: number, a: string, b: string | undefined, currency: Currency, viaSalaryWord: boolean): Candidate | null {
  const before = text.slice(Math.max(0, index - 60), index);
  const after = text.slice(index + length, index + length + 40);
  if (NOT_A_SALARY_AFTER.test(after) || NOT_A_SALARY_BEFORE.test(before)) return null;

  const salaryWordNear = viaSalaryWord || SALARY_WORD_BEFORE.test(before);
  if (!salaryWordNear && BONUS_BEFORE.test(before)) return null;

  const x = parseAmount(a);
  const y = b ? parseAmount(b) : x;
  const min = Math.min(x, y);
  const max = Math.max(x, y);
  if (!(min > 0)) return null;

  const foreign = currency !== 'GEL';
  let period: Candidate['period'] =
    HOURLY_AFTER.test(after) || HOURLY_BEFORE.test(before)
      ? 'hour'
      : DAILY_AFTER.test(after) || DAILY_BEFORE.test(before)
        ? 'day'
        : foreign && min >= YEARLY_MIN_FOREIGN
          ? 'year'
          : foreign && max < 200
            ? 'hour' // "Pay Range: $19.00 - $19.50": US listings state small amounts per hour
            : 'month';
  // Plausible amounts per period: below these it's a schedule, a count or a price; above, a loan or turnover
  const fits = (p: Candidate['period']) => {
    const [low, high] = { hour: [3, 500], day: [10, 2_000], month: [100, MAX_MONTHLY], year: [YEARLY_MIN_FOREIGN, MAX_YEARLY] }[p];
    return min >= low && max <= high;
  };
  // "საათობრივი, მინიმუმ 1700 ლარი": too much for an hour or a day, so it's the monthly amount
  if (!fits(period) && period !== 'month' && fits('month')) period = 'month';
  if (!fits(period)) return null;

  return { index, min, max, currency, viaSalaryWord: salaryWordNear, period, from: FROM_AFTER.test(after) };
}

function format(c: Candidate): string {
  const n = (v: number) => (Number.isInteger(v) ? v.toLocaleString('en-US').replace(/,/g, ' ') : v.toFixed(2));
  const range = `${n(c.min)}${c.max !== c.min ? `–${n(c.max)}` : ''}${c.from && c.max === c.min ? '+' : ''}`;
  const amount = c.currency === 'USD' ? `$${range}` : c.currency === 'EUR' ? `${range} €` : `${range} ლარი`;
  return { month: amount, hour: `${amount}/სთ`, day: `${amount}/დღე`, year: `${amount}/წელი` }[c.period];
}

export function extractJobSalary(job: { vacancy?: string | null; description?: string | null }): string {
  const text = plainText(`${job.vacancy ?? ''}\n${job.description ?? ''}`);
  const found: Candidate[] = [];

  for (const m of text.matchAll(CURRENCY_FIRST)) {
    const c = candidate(text, m.index!, m[0].length, m[2], m[3], currencyOf(m[1]), false);
    if (c) found.push(c);
  }
  for (const m of text.matchAll(AMOUNT_FIRST)) {
    const c = candidate(text, m.index!, m[0].length, m[1], m[2], currencyOf(m[4]), false);
    if (c) {
      if (/იდან$|ზე$/.test(m[4]) || /დან|\+/.test(m[3] ?? '')) c.from = true;
      found.push(c);
    }
  }
  for (const m of text.matchAll(AFTER_KEYWORD)) {
    if (BY_AGREEMENT_OR_SCHEDULE.test(m[1])) continue;
    const start = m.indices![2][0];
    const end = m.index! + m[0].length;
    if (NOT_MONEY_AFTER.test(text.slice(end, end + 15))) continue;
    const c = candidate(text, start, end - start, m[2], m[3], 'GEL', true);
    if (c) found.push(c);
  }
  if (!found.length) return '';

  // Prefer an amount named as the salary; then the earliest in the text
  found.sort((p, q) => Number(q.viaSalaryWord) - Number(p.viaSalaryWord) || p.index - q.index);
  return format(found[0]);
}
